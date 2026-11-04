"""M0 reconciliation prototype: real HTTP, SQLite queue, byte hashes and real files.

Catalog bootstrap and subsequent changes are paginated; caches publish only complete views.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import sqlite3
import time
import uuid
from collections.abc import Callable

from .credentials import protect
from .filesystem import Filesystem, MARKER, digest, excluded, valid_path
from .transport import Remote, SyncError
from .state_lock import StateLock
from .scope import SyncScope
from .renames import Renames
from .remote_catalog import RemoteCatalog
from .initial_merge import InitialMerge


def configure(url: str, root: Path, state: Path, code: str, *, allow_existing: bool = False) -> dict:
    root = root.absolute()
    state = state.absolute()
    for directory in (root, state):
        if any(part.is_symlink() or part.is_junction() for part in (directory, *directory.parents)):
            raise SyncError("UNSAFE_LINK")
    root = root.resolve()
    state = state.resolve()
    if root == state or state.is_relative_to(root) or root.is_relative_to(state):
        raise SyncError("STATE_MUST_BE_SEPARATE")
    with StateLock(state):
        root.mkdir(parents=True, exist_ok=True)
        if any((directory / MARKER).exists() or (directory / MARKER).is_symlink() for directory in (root, *root.parents)):
            raise SyncError('DIRECTORY_ALREADY_BOUND')
        if not allow_existing and any(not excluded(item.name) for item in root.iterdir()):
            raise SyncError("M0_REQUIRES_NEW_EMPTY_DIRECTORY")
        if allow_existing:
            def unavailable(_):
                raise SyncError('DIRECTORY_UNAVAILABLE')
            for directory, dirs, names in os.walk(root, followlinks=False, onerror=unavailable):
                parent = Path(directory)
                dirs[:] = [name for name in dirs if not (parent / name).is_symlink() and not (parent / name).is_junction()]
                if any(name.casefold() == MARKER.casefold() for name in names):
                    raise SyncError('DIRECTORY_ALREADY_BOUND')
        state.mkdir(parents=True, exist_ok=True)
        if any(state.iterdir()):
            raise SyncError("STATE_ALREADY_EXISTS")
        pairing = Remote(url).request("/pair", body={"code": code})
        encrypted = protect(pairing["token"].encode("ascii"))
        identity = str(uuid.uuid4())
        (state / "device.dpapi").write_bytes(encrypted)
        with (root / MARKER).open('x', encoding='ascii') as marker:
            marker.write(identity)
        config = {"url": url, "root": str(root), "identity": identity, "device": pairing["id"], 'initialMergeReview': True}
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
        self.remote_folders: set[str] = set()
        self.state_lock = StateLock(self.state)
        try:
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
            CREATE TABLE IF NOT EXISTS local_identity (path TEXT PRIMARY KEY, identity TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS rename_queue (source TEXT PRIMARY KEY, target TEXT NOT NULL, operation TEXT NOT NULL,
                request TEXT NOT NULL, identity TEXT NOT NULL, attempted INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS local_rename (id TEXT PRIMARY KEY, intent TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS remote_catalog (id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS reconciliation_archive (id TEXT PRIMARY KEY, created REAL NOT NULL, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS conflict_resolution (id TEXT PRIMARY KEY, path TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL);
            """)
            cached_scope = self.db.execute("SELECT value FROM setting WHERE key = 'scope_policy'").fetchone()
            cached = json.loads(cached_scope[0]) if cached_scope else {}
            self.scope_known = cached_scope is not None
            self.selection = SyncScope(cached.get('scope'), cached.get('attachments', []))
            self.remote.scope_version = cached.get('version')
            self.rename_supported = cached.get('fileRenameSupported', False)
        except Exception:
            if hasattr(self, 'db'):
                self.db.close()
            self.state_lock.close()
            raise

    def close(self):
        try:
            self.db.close()
        finally:
            self.state_lock.close()

    def baseline(self) -> dict:
        return {row["path"]: json.loads(row["metadata"]) for row in self.db.execute("SELECT * FROM baseline")}

    def acknowledge(self, file: dict):
        self.db.execute("INSERT OR REPLACE INTO baseline VALUES (?, ?)", (file["path"], json.dumps(file)))
        data, identity = self.fs.read_state(file['path'])
        if file['deleted']:
            self.db.execute('DELETE FROM local_identity WHERE path = ?', (file['path'],))
        elif identity and data is not None and digest(data) == file['sha256']:
            self.db.execute('INSERT OR REPLACE INTO local_identity VALUES (?, ?)', (file['path'], identity))
        self.db.commit()

    def enqueue(self, path: str, file: dict | None, data: bytes | None, *, deleted: bool = False, identity: str | None = None):
        request = {"id": file["id"] if file else None, "path": path, "baseVersion": file["version"] if file else "0",
                   "deleted": deleted, "sha256": digest(data) if data is not None else None,
                   "contentBase64": base64.b64encode(data).decode("ascii") if data is not None else None}
        inserted = self.db.execute("INSERT OR IGNORE INTO queue VALUES (?, ?, ?)", (path, str(uuid.uuid4()), json.dumps(request)))
        if inserted.rowcount and identity:
            self.db.execute('INSERT OR REPLACE INTO local_identity VALUES (?, ?)', (path, identity))
        self.db.commit()

    def status(self) -> dict:
        queued = [row['path'] for row in self.db.execute('SELECT path FROM queue')]
        rename_queued = list(self.db.execute('SELECT source, target FROM rename_queue'))
        eligible_renames = sum(self.selection.explicit(row['source']) and self.selection.explicit(row['target']) for row in rename_queued)
        transfer = self.db.execute("SELECT value FROM setting WHERE key = 'remote_transfer'").fetchone()
        return {"queued": sum(self.selection.includes(path) for path in queued) + eligible_renames,
                "reconciliationArchives": self.db.execute('SELECT COUNT(*) FROM reconciliation_archive').fetchone()[0],
                "heldQueued": sum(not self.selection.includes(path) for path in queued) + len(rename_queued) - eligible_renames,
                "pendingRenames": len(rename_queued),
                "catalog": json.loads(transfer[0]) if transfer else None,
                "scope": self.selection.data() if self.scope_known else None,
                "conflicts": [{"path": row["path"], "reason": row["reason"], "copies": json.loads(row["copies"])}
                              for row in self.db.execute("SELECT * FROM conflict ORDER BY path") if self.selection.includes(row['path'])]}

    def snapshot(self, checkpoint=None) -> dict:
        catalog = RemoteCatalog(self.db, self.remote)
        snapshot, fresh, updates, removed, transfer = catalog.fetch(checkpoint)
        selection = SyncScope(snapshot.get('scope'), snapshot.get('attachmentPaths', []))
        version = snapshot.get('scopeVersion', '1')
        previous = self.db.execute("SELECT value FROM setting WHERE key = 'cursor'").fetchone()
        if previous and int(snapshot["cursor"]) < int(previous[0]):
            raise SyncError("SERVER_ROLLBACK_RECONCILIATION_REQUIRED")
        previous_scope = self.db.execute("SELECT value FROM setting WHERE key = 'scope_policy'").fetchone()
        old = json.loads(previous_scope[0]) if previous_scope else {'version': '1', 'scope': {'all': True, 'folders': []}}
        with self.db:
            if (old['version'] != version or old['scope'] != selection.data()) and not InitialMerge(self).pending():
                # A selection revision never replays old deletion assumptions.
                # Initial merges already disable deletion inference; reviewing a changed scope
                # must retain the partially completed attempt's baselines and durable queue.
                self.db.execute('DELETE FROM baseline')
                self.db.execute('DELETE FROM local_identity WHERE path NOT IN (SELECT path FROM queue)')
                self.db.execute('DELETE FROM local_rename')
                self.db.execute('DELETE FROM missing')
                self.db.execute("DELETE FROM setting WHERE key = 'delete_review'")
                for row in list(self.db.execute('SELECT path, request FROM queue')):
                    if json.loads(row['request'])['deleted']:
                        self.db.execute('DELETE FROM queue WHERE path = ?', (row['path'],))
            catalog.store(snapshot, fresh, updates, removed, transfer)
            self.db.execute("INSERT OR REPLACE INTO setting VALUES ('scope_policy', ?)",
                            (json.dumps({'version': version, 'scope': selection.data(), 'attachments': list(selection.attachments),
                                         'fileRenameSupported': snapshot.get('fileRenameSupported', False)}),))
            self.db.execute("INSERT OR REPLACE INTO setting VALUES ('cursor', ?)", (snapshot["cursor"],))
        self.selection = selection
        self.scope_known = True
        self.remote.scope_version = version
        self.rename_supported = snapshot.get('fileRenameSupported', False)
        self.remote_folders = {item['path'] for item in snapshot['items'] if item['type'] == 'folder'
                               and not item['deleted'] and selection.directory(item['path']) and not excluded(item['path'])}
        return {item["id"]: item for item in snapshot["items"] if item["type"] != "folder" and selection.includes(item['path'])}

    def prepare_directories(self, checkpoint: Callable[[], None] | None = None) -> list[dict]:
        protected = set()
        for file in self.baseline().values():
            if file['deleted'] or not self.selection.includes(file['path']):
                continue
            parts = file['path'].split('/')
            protected.update('/'.join(parts[:index]) for index in range(1, len(parts)))
        issues = []
        for path in sorted(self.remote_folders, key=lambda path: (path.count('/'), path)):
            if checkpoint:
                checkpoint()
            if any(path.startswith(issue['path'] + '/') for issue in issues):
                continue
            try:
                self.fs.ensure_directory(path, has_baseline=path in protected)
            except (SyncError, OSError) as error:
                issues.append({'path': path, 'code': error.code if isinstance(error, SyncError) else 'DIRECTORY_UNAVAILABLE'})
        return issues

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

    def cycle(self, *, confirmation: str | None = None, initial_confirmation: str | None = None,
              should_pause: Callable[[], bool] | None = None) -> dict:
        issues = []
        write_failure = None
        initial = InitialMerge(self)
        merging = initial.pending()
        approved_local = None
        def checkpoint():
            if should_pause and should_pause():
                raise SyncError('PAUSE_REQUESTED')
        try:
            checkpoint()
            if merging:
                preview, approved_local = initial.preview(checkpoint)
                if not preview['canApply'] or preview['requiresConfirmation'] and preview['fingerprint'] != initial_confirmation:
                    return {'status': 'INITIAL_MERGE_REVIEW_REQUIRED', 'code': 'INITIAL_MERGE_CHANGED' if initial_confirmation else None,
                            'initialMergePreview': preview, 'issues': preview['issues'], **self.status()}
                initial.begin(preview['fingerprint'])
                issues.extend(preview['issues'])
            try:
                initial_remote = self.snapshot(checkpoint)
                if merging:
                    initial.validate_remote(initial_remote)
                issues.extend(self.prepare_directories(checkpoint))
            except SyncError as error:
                if error.code != 'NETWORK_UNAVAILABLE' or not self.scope_known:
                    raise
                initial_remote = None
                # Offline capture uses the last confirmed scope only; nothing is published offline.
            first_identities = {}
            first, first_issues = self.fs.scan(include=self.selection.includes, descend=self.selection.descends, identities=first_identities)
            scanned_attachments = self.selection.attachments
            time.sleep(self.stable_seconds)
            identities = {}
            local, second_issues = self.fs.scan(include=self.selection.includes, descend=self.selection.descends, identities=identities)
            issues.extend(first_issues + second_issues)
            unstable = {path for path in first.keys() | local.keys() if first.get(path) != local.get(path)}
            unstable.update(path for path in first_identities.keys() | identities.keys() if first_identities.get(path) != identities.get(path))
            if merging and local != approved_local:
                raise SyncError('INITIAL_MERGE_CHANGED')
            issues.extend({"path": path, "code": "FILE_BUSY"} for path in unstable)
            blocked = {row[0] for row in self.db.execute("SELECT path FROM conflict")}
            unsafe = [issue["path"] for issue in issues]
            def skip(path):
                return not self.selection.includes(path) or path in blocked or path in unstable or any(path == bad or path.startswith(bad + "/") for bad in unsafe)
            renames = Renames(self)
            relocated, rename_issues, rename_blocked, outcome = (renames.receive(initial_remote, local, identities, skip, confirmation, checkpoint)
                                                               if initial_remote is not None and not merging else (False, [], set(), None))
            issues.extend(rename_issues)
            if outcome:
                return {**outcome, 'issues': issues, **self.status()}
            if rename_issues:
                return {'status': 'PAUSED', 'code': 'RENAME_REQUIRES_RECONCILIATION', 'issues': issues, **self.status()}
            blocked.update(rename_blocked)
            if relocated:
                identities = {}
                local, rescan_issues = self.fs.scan(include=self.selection.includes, descend=self.selection.descends, identities=identities)
                issues.extend(rescan_issues)
                unsafe.extend(item['path'] for item in rescan_issues)
            outcome, rename_blocked = renames.send(local, identities, skip, confirmation, checkpoint) if not merging else (None, set())
            if outcome:
                return {**outcome, 'issues': issues + outcome.get('issues', []), **self.status()}
            blocked.update(rename_blocked)
            baseline = self.baseline()
            tombstones = {file['path'].casefold() for file in (initial_remote or {}).values() if file['deleted']}
            initial_paths = {file['path']: file for file in (initial_remote or {}).values()}
            queued_paths = {row['path'] for row in self.db.execute('SELECT path FROM queue')}
            queued_identities = {row['path']: row['identity'] for row in self.db.execute('SELECT path, identity FROM local_identity') if row['path'] in queued_paths}
            moved_uploads = {(source, path) for path, key in identities.items() for source, known in queued_identities.items() if source != path and known == key}
            deferred_renames = {path for _, path in moved_uploads}
            deferred_sources = {source for source, _ in moved_uploads}
            # Persist uploads before contacting the network, so an offline run still captures edits.
            for path, sha in local.items():
                checkpoint()
                if skip(path) or path in deferred_renames:
                    continue
                base = baseline.get(path)
                if merging and path in initial_paths and initial_paths[path]['sha256'] != sha:
                    # First merge preserves differing variants even after a partially completed attempt.
                    continue
                if base is None and path.casefold() in tombstones:
                    if merging:
                        continue
                    issues.append({'path': path, 'code': 'DELETED_REMOTE_REQUIRES_RECONCILIATION'})
                    blocked.add(path)
                    continue
                if base and base["deleted"]:
                    issues.append({"path": path, "code": "DELETED_BASELINE_REQUIRES_RECONCILIATION"}); continue
                if not base or sha != base["sha256"]:
                    data, identity = self.fs.read_state(path)
                    if data is not None and digest(data) == sha and identity == identities.get(path):
                        self.enqueue(path, base, data, identity=identity)
            checkpoint()
            remote = self.snapshot(checkpoint)
            if merging:
                initial.validate_remote(remote)
            by_path = {file["path"].casefold(): file for file in remote.values()}
            for row in list(self.db.execute("SELECT * FROM queue ORDER BY path")):
                checkpoint()
                path = row["path"]
                if skip(path):
                    continue
                request = json.loads(row["request"])
                if request['deleted'] and not self.selection.explicit(path):
                    continue
                file = remote.get(request["id"]) if request["id"] else by_path.get(path.casefold())
                if request["deleted"] and self.fs.read(path) is not None:
                    self.db.execute("DELETE FROM queue WHERE path = ?", (path,)); self.db.commit(); continue
                if file and file['deleted']:
                    if request['deleted']:
                        self.acknowledge(file)
                        self.db.execute('DELETE FROM queue WHERE path = ?', (path,)); self.db.commit()
                    else:
                        self.conflict(path, file, request, 'DELETE_MODIFY' if request['id'] else 'INITIAL_TOMBSTONE')
                        blocked.add(path)
                    continue
                if file and not file["deleted"] and not request["deleted"] and file["path"] == path and file["sha256"] == request["sha256"]:
                    self.acknowledge(file)
                    self.db.execute("DELETE FROM queue WHERE path = ?", (path,)); self.db.commit(); continue
                if merging and file and not request['deleted']:
                    self.conflict(path, file, request, 'INITIAL_COLLISION')
                    blocked.add(path)
                    continue
                try:
                    result = self.remote.request("/files", body=request, operation=row["operation"])
                    if merging:
                        initial.published(result)
                    self.acknowledge(result)
                    self.db.execute("DELETE FROM queue WHERE path = ?", (path,)); self.db.commit()
                except SyncError as error:
                    if merging and error.status == 409:
                        raise SyncError('INITIAL_MERGE_CHANGED') from None
                    if error.code == 'SYNC_SCOPE_CHANGED':
                        raise
                    if error.status != 409:
                        if error.status in (401, 403) or not error.status:
                            raise
                        issues.append({"path": path, "code": error.code})
                        unsafe.append(path)
                        write_failure = error.code
                        continue
                    if path in deferred_sources:
                        issues.append({'path': path, 'code': 'RENAME_MODIFY_CONFLICT'})
                        unsafe.extend(candidate for pair in moved_uploads for candidate in pair)
                        write_failure = 'RENAME_REQUIRES_RECONCILIATION'
                        continue
                    latest = self.snapshot(checkpoint)
                    file = latest.get(request["id"]) if request["id"] else next((item for item in latest.values() if item["path"].casefold() == path.casefold()), None)
                    if file is None:
                        issues.append({"path": path, "code": "BASELINE_LOST"}); continue
                    self.conflict(path, file, request, "DELETE_MODIFY" if request["deleted"] or file["deleted"] else "BOTH_MODIFIED")
                    blocked.add(path)
            blocked.update(deferred_sources)
            checkpoint()
            remote = self.snapshot(checkpoint)
            if merging:
                initial.validate_remote(remote)
            for issue in self.prepare_directories(checkpoint):
                if issue not in issues:
                    issues.append(issue)
                    unsafe.append(issue['path'])
            baseline = self.baseline()
            deletes = []
            for file in remote.values():
                checkpoint()
                path = file["path"]
                if skip(path) or excluded(path):
                    continue
                if not valid_path(path):
                    issues.append({"path": path, "code": "INVALID_PATH"}); continue
                base = baseline.get(path)
                if base and base['id'] != file['id']:
                    base = None
                if base and not self.fs.path(path).parent.is_dir():
                    issues.append({"path": path, "code": "PARENT_DIRECTORY_UNAVAILABLE"}); continue
                same_id = next((old for old in baseline.values() if old["id"] == file["id"]), None)
                if same_id and same_id["path"] != path:
                    issues.append({"path": path, "code": "REMOTE_RENAME_REQUIRES_RECONCILIATION"}); continue
                data = self.fs.read(path)
                sha = digest(data) if data is not None else None
                if file["deleted"]:
                    if merging:
                        if data is not None:
                            self.conflict(path, file, None, 'INITIAL_TOMBSTONE')
                        else:
                            self.acknowledge(file)
                        continue
                    if base is None:
                        # No common baseline: an old tombstone is never permission to delete a local file.
                        if data is not None:
                            self.conflict(path, file, None, "INITIAL_TOMBSTONE")
                        else:
                            self.acknowledge(file)
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
                if merging and data is None:
                    self.fs.atomic(path, self.download(file), None); self.acknowledge(file)
                    continue
                if merging:
                    # A partial attempt's baseline must not turn the newly approved
                    # "preserve both" preview into an overwrite of the local variant.
                    self.conflict(path, file, None, 'INITIAL_COLLISION')
                    continue
                if base is None:
                    if data is None:
                        self.fs.atomic(path, self.download(file), None); self.acknowledge(file)
                    else:
                        self.conflict(path, file, None, "INITIAL_COLLISION")
                elif data is None and file["version"] == base["version"]:
                    if not self.selection.explicit(path):
                        self.fs.atomic(path, self.download(file), None); self.acknowledge(file)
                        continue
                    missing = self.db.execute("SELECT since FROM missing WHERE path = ?", (path,)).fetchone()
                    if missing is None:
                        self.db.execute("INSERT INTO missing VALUES (?, ?)", (path, time.time())); self.db.commit()
                    elif time.time() - missing[0] >= self.delete_grace:
                        deletes.append({"direction": "remote", "path": path, "id": file["id"], "version": file["version"], "sha": base["sha256"]})
                elif data is None:
                    if base['deleted']:
                        self.fs.atomic(path, self.download(file), None); self.acknowledge(file)
                    else:
                        self.conflict(path, file, None, "DELETE_MODIFY")
                elif sha == base["sha256"]:
                    self.fs.atomic(path, self.download(file), sha); self.acknowledge(file)
                else:
                    self.conflict(path, file, None, "BOTH_MODIFIED")
            for path in local:
                self.db.execute("DELETE FROM missing WHERE path = ?", (path,))
            self.db.commit()
            deletes.sort(key=lambda item: (item["path"], item["direction"]))
            active_count = max(1, sum(not item["deleted"] and self.selection.includes(item['path']) for item in baseline.values()))
            pending_review = self.db.execute("SELECT value FROM setting WHERE key = 'delete_review'").fetchone()
            # Once held for review, a shrinking batch must not silently fall back below the threshold.
            needs_confirmation = bool(deletes) and (pending_review is not None or confirmation is not None
                                                   or len(deletes) > 20 or len(deletes) / active_count > .1)
            fingerprint = digest(json.dumps(deletes, sort_keys=True).encode()) if deletes else None
            if not needs_confirmation or fingerprint == confirmation:
                for deletion in deletes:
                    checkpoint()
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
                self.db.execute("DELETE FROM setting WHERE key = 'delete_review'")
                self.db.commit()
                pending_delete = None
            else:
                self.db.execute("INSERT OR REPLACE INTO setting VALUES ('delete_review', ?)", (fingerprint,))
                self.db.commit()
                pending_delete = {"fingerprint": fingerprint, "changes": deletes}
            rescan = bool(deferred_renames or self.selection.attachments - scanned_attachments)
            if merging and not write_failure and not pending_delete and not rescan and self.status()['queued'] == 0:
                initial.validate_remote(self.snapshot(checkpoint))
                initial.finish()
            return {"status": "PAUSED" if write_failure else "REQUIRES_CONFIRMATION" if pending_delete else "OK", "code": write_failure, "issues": issues,
                    "deletionPreview": pending_delete, "rescanRequired": rescan, **self.status()}
        except (SyncError, OSError, sqlite3.Error) as error:
            return {"status": "PAUSED", "code": error.code if isinstance(error, SyncError) else "LOCAL_IO_UNAVAILABLE",
                    "issues": issues, **self.status()}
