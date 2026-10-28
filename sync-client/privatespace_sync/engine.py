"""M0 reconciliation prototype: real HTTP, SQLite queue, byte hashes and real files.

This is deliberately a bounded full-snapshot prototype, not the M2 incremental client.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import sqlite3
import time
import uuid

from .credentials import protect
from .filesystem import Filesystem, MARKER, digest, excluded, valid_path
from .transport import Remote, SyncError


def configure(url: str, root: Path, state: Path, code: str) -> dict:
    root = root.absolute()
    state = state.absolute()
    for directory in (root, state):
        if any(part.is_symlink() or part.is_junction() for part in (directory, *directory.parents)):
            raise SyncError("UNSAFE_LINK")
    root = root.resolve()
    state = state.resolve()
    if root == state or state.is_relative_to(root) or root.is_relative_to(state):
        raise SyncError("STATE_MUST_BE_SEPARATE")
    root.mkdir(parents=True, exist_ok=True)
    if any(not excluded(item.name) for item in root.iterdir()) or (root / MARKER).exists():
        raise SyncError("M0_REQUIRES_NEW_EMPTY_DIRECTORY")
    state.mkdir(parents=True, exist_ok=True)
    if any(state.iterdir()):
        raise SyncError("STATE_ALREADY_EXISTS")
    pairing = Remote(url).request("/pair", body={"code": code})
    encrypted = protect(pairing["token"].encode("ascii"))
    identity = str(uuid.uuid4())
    (state / "device.dpapi").write_bytes(encrypted)
    (root / MARKER).write_text(identity, encoding="ascii")
    config = {"url": url, "root": str(root), "identity": identity, "device": pairing["id"]}
    (state / "config.json").write_text(json.dumps(config), encoding="utf-8")
    return {"device": pairing["id"], "root": str(root)}


class Engine:
    def __init__(self, state: Path, *, stable_seconds: float = 1.0, delete_grace: float = 2.0):
        self.state = state.absolute()
        self.config = json.loads((self.state / "config.json").read_text(encoding="utf-8"))
        token = protect((self.state / "device.dpapi").read_bytes(), decrypt=True).decode("ascii")
        self.remote = Remote(self.config["url"], token)
        self.fs = Filesystem(Path(self.config["root"]), self.config["identity"])
        self.stable_seconds = stable_seconds
        self.delete_grace = delete_grace
        self.db = sqlite3.connect(self.state / "sync.sqlite")
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS baseline (path TEXT PRIMARY KEY, metadata TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS queue (path TEXT PRIMARY KEY, operation TEXT NOT NULL, request TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS conflict (path TEXT PRIMARY KEY, reason TEXT NOT NULL, copies TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS missing (path TEXT PRIMARY KEY, since REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """)

    def close(self):
        self.db.close()

    def baseline(self) -> dict:
        return {row["path"]: json.loads(row["metadata"]) for row in self.db.execute("SELECT * FROM baseline")}

    def acknowledge(self, file: dict):
        self.db.execute("INSERT OR REPLACE INTO baseline VALUES (?, ?)", (file["path"], json.dumps(file)))
        self.db.commit()

    def enqueue(self, path: str, file: dict | None, data: bytes | None, *, deleted: bool = False):
        request = {"id": file["id"] if file else None, "path": path, "baseVersion": file["version"] if file else "0",
                   "deleted": deleted, "sha256": digest(data) if data is not None else None,
                   "contentBase64": base64.b64encode(data).decode("ascii") if data is not None else None}
        self.db.execute("INSERT OR IGNORE INTO queue VALUES (?, ?, ?)", (path, str(uuid.uuid4()), json.dumps(request)))
        self.db.commit()

    def status(self) -> dict:
        return {"queued": self.db.execute("SELECT COUNT(*) FROM queue").fetchone()[0],
                "conflicts": [{"path": row["path"], "reason": row["reason"], "copies": json.loads(row["copies"])}
                              for row in self.db.execute("SELECT * FROM conflict ORDER BY path")]}

    def snapshot(self) -> dict:
        snapshot = self.remote.request("/snapshot")
        previous = self.db.execute("SELECT value FROM setting WHERE key = 'cursor'").fetchone()
        if previous and int(snapshot["cursor"]) < int(previous[0]):
            raise SyncError("SERVER_ROLLBACK_RECONCILIATION_REQUIRED")
        self.db.execute("INSERT OR REPLACE INTO setting VALUES ('cursor', ?)", (snapshot["cursor"],))
        self.db.commit()
        return {item["id"]: item for item in snapshot["items"] if item["type"] != "folder"}

    def download(self, file: dict) -> bytes:
        data = self.remote.request(f'/files/{file["id"]}?version={file["version"]}', binary=True)
        if digest(data) != file["sha256"] or len(data) != file["size"]:
            raise SyncError("CHECKSUM_MISMATCH")
        return data

    def conflict(self, path: str, remote: dict, queued: dict | None, reason: str):
        local = self.fs.read(path)
        versions = []
        if queued and not queued["deleted"]:
            versions.append(base64.b64decode(queued["contentBase64"], validate=True))
        if local is not None and not any(digest(local) == digest(data) for data in versions):
            versions.append(local)
        copies = []
        for data in versions:
            original = Path(path)
            name = f"{original.stem} (conflict-{self.config['device'][:8]}-{uuid.uuid4().hex[:8]}){original.suffix}"
            copy = (original.parent / name).as_posix()
            self.fs.atomic(copy, data, None)
            copies.append(copy)
        # Never replace a local edit until every local variant has a durable copy.
        if not remote["deleted"] and remote["path"] == path:
            data = self.download(remote)
            self.fs.atomic(path, data, digest(local) if local is not None else None)
            self.acknowledge(remote)
        self.db.execute("INSERT OR REPLACE INTO conflict VALUES (?, ?, ?)", (path, reason, json.dumps(copies)))
        self.db.execute("DELETE FROM queue WHERE path = ?", (path,))
        self.db.commit()

    def archive(self, path: str, data: bytes, version: str):
        directory = self.state / "recycle"
        directory.mkdir(exist_ok=True)
        backup = directory / (str(uuid.uuid4()) + ".bin")
        with backup.open("xb") as output:
            output.write(data); output.flush(); os.fsync(output.fileno())
        with (directory / (backup.stem + ".json")).open("x", encoding="utf-8") as output:
            json.dump({"path": path, "version": version, "sha256": digest(data)}, output)
            output.flush(); os.fsync(output.fileno())

    def cycle(self, *, confirmation: str | None = None) -> dict:
        issues = []
        write_failure = None
        try:
            first, first_issues = self.fs.scan()
            time.sleep(self.stable_seconds)
            local, second_issues = self.fs.scan()
            issues.extend(first_issues + second_issues)
            unstable = {path for path in first.keys() | local.keys() if first.get(path) != local.get(path)}
            issues.extend({"path": path, "code": "FILE_BUSY"} for path in unstable)
            blocked = {row[0] for row in self.db.execute("SELECT path FROM conflict")}
            unsafe = [issue["path"] for issue in issues]
            def skip(path):
                return path in blocked or path in unstable or any(path == bad or path.startswith(bad + "/") for bad in unsafe)
            baseline = self.baseline()
            # Persist uploads before contacting the network, so an offline run still captures edits.
            for path, sha in local.items():
                if skip(path):
                    continue
                base = baseline.get(path)
                if base and base["deleted"]:
                    issues.append({"path": path, "code": "DELETED_BASELINE_REQUIRES_RECONCILIATION"}); continue
                if not base or sha != base["sha256"]:
                    data = self.fs.read(path)
                    if data is not None and digest(data) == sha:
                        self.enqueue(path, base, data)
            remote = self.snapshot()
            by_path = {file["path"].casefold(): file for file in remote.values()}
            for row in list(self.db.execute("SELECT * FROM queue ORDER BY path")):
                path = row["path"]
                if skip(path):
                    continue
                request = json.loads(row["request"])
                file = remote.get(request["id"]) if request["id"] else by_path.get(path.casefold())
                if request["deleted"] and self.fs.read(path) is not None:
                    self.db.execute("DELETE FROM queue WHERE path = ?", (path,)); self.db.commit(); continue
                if file and not file["deleted"] and not request["deleted"] and file["path"] == path and file["sha256"] == request["sha256"]:
                    self.acknowledge(file)
                    self.db.execute("DELETE FROM queue WHERE path = ?", (path,)); self.db.commit(); continue
                try:
                    result = self.remote.request("/files", body=request, operation=row["operation"])
                    self.acknowledge(result)
                    self.db.execute("DELETE FROM queue WHERE path = ?", (path,)); self.db.commit()
                except SyncError as error:
                    if error.status != 409:
                        if error.status in (401, 403) or not error.status:
                            raise
                        issues.append({"path": path, "code": error.code})
                        unsafe.append(path)
                        write_failure = error.code
                        continue
                    latest = self.snapshot()
                    file = latest.get(request["id"]) if request["id"] else next((item for item in latest.values() if item["path"].casefold() == path.casefold()), None)
                    if file is None:
                        issues.append({"path": path, "code": "BASELINE_LOST"}); continue
                    self.conflict(path, file, request, "DELETE_MODIFY" if request["deleted"] or file["deleted"] else "BOTH_MODIFIED")
                    blocked.add(path)
            remote = self.snapshot()
            baseline = self.baseline()
            deletes = []
            for file in remote.values():
                path = file["path"]
                if skip(path) or excluded(path):
                    continue
                if not valid_path(path):
                    issues.append({"path": path, "code": "INVALID_PATH"}); continue
                base = baseline.get(path)
                if base and not self.fs.path(path).parent.is_dir():
                    issues.append({"path": path, "code": "PARENT_DIRECTORY_UNAVAILABLE"}); continue
                same_id = next((old for old in baseline.values() if old["id"] == file["id"]), None)
                if same_id and same_id["path"] != path:
                    issues.append({"path": path, "code": "REMOTE_RENAME_REQUIRES_RECONCILIATION"}); continue
                data = self.fs.read(path)
                sha = digest(data) if data is not None else None
                if file["deleted"]:
                    if base is None:
                        # No common baseline: an old tombstone is never permission to delete a local file.
                        if data is not None:
                            self.conflict(path, file, None, "INITIAL_TOMBSTONE")
                        continue
                    if data is None:
                        self.acknowledge(file)
                    elif sha == base["sha256"] and not base["deleted"]:
                        deletes.append({"direction": "local", "path": path, "id": file["id"], "version": file["version"], "sha": sha})
                    else:
                        self.conflict(path, file, None, "DELETE_MODIFY")
                    continue
                if sha == file["sha256"]:
                    self.acknowledge(file); continue
                if base is None:
                    if data is None:
                        self.fs.atomic(path, self.download(file), None); self.acknowledge(file)
                    else:
                        self.conflict(path, file, None, "INITIAL_COLLISION")
                elif data is None and file["version"] == base["version"]:
                    missing = self.db.execute("SELECT since FROM missing WHERE path = ?", (path,)).fetchone()
                    if missing is None:
                        self.db.execute("INSERT INTO missing VALUES (?, ?)", (path, time.time())); self.db.commit()
                    elif time.time() - missing[0] >= self.delete_grace:
                        deletes.append({"direction": "remote", "path": path, "id": file["id"], "version": file["version"], "sha": base["sha256"]})
                elif data is None:
                    self.conflict(path, file, None, "DELETE_MODIFY")
                elif sha == base["sha256"]:
                    self.fs.atomic(path, self.download(file), sha); self.acknowledge(file)
                else:
                    self.conflict(path, file, None, "BOTH_MODIFIED")
            for path in local:
                self.db.execute("DELETE FROM missing WHERE path = ?", (path,))
            self.db.commit()
            deletes.sort(key=lambda item: (item["path"], item["direction"]))
            active_count = max(1, sum(not item["deleted"] for item in baseline.values()))
            needs_confirmation = len(deletes) > 20 or len(deletes) / active_count > .1
            fingerprint = digest(json.dumps(deletes, sort_keys=True).encode()) if deletes else None
            if not needs_confirmation or fingerprint == confirmation:
                for deletion in deletes:
                    path = deletion["path"]
                    file = remote[deletion["id"]]
                    data = self.fs.read(path)
                    if deletion["direction"] == "remote":
                        if data is not None:
                            raise SyncError("LOCAL_CHANGED_BEFORE_DELETE")
                        self.enqueue(path, file, None, deleted=True)
                        row = self.db.execute("SELECT * FROM queue WHERE path = ?", (path,)).fetchone()
                        result = self.remote.request("/files", body=json.loads(row["request"]), operation=row["operation"])
                        self.acknowledge(result)
                        self.db.execute("DELETE FROM queue WHERE path = ?", (path,)); self.db.commit()
                    else:
                        if data is None or digest(data) != deletion["sha"]:
                            raise SyncError("LOCAL_CHANGED_BEFORE_DELETE")
                        self.archive(path, data, file["version"])
                        if self.fs.read(path) != data:
                            raise SyncError("LOCAL_CHANGED_BEFORE_DELETE")
                        self.fs.path(path).unlink()
                        self.acknowledge(file)
                pending_delete = None
            else:
                pending_delete = {"fingerprint": fingerprint, "changes": deletes}
            return {"status": "PAUSED" if write_failure else "REQUIRES_CONFIRMATION" if pending_delete else "OK", "code": write_failure, "issues": issues,
                    "deletionPreview": pending_delete, **self.status()}
        except (SyncError, OSError, sqlite3.Error) as error:
            return {"status": "PAUSED", "code": error.code if isinstance(error, SyncError) else "LOCAL_IO_UNAVAILABLE",
                    "issues": issues, **self.status()}
