"""Opt-in M0 real-transport scenarios launched by NotesIT, never against a user database.

The relay only forwards real backend bytes. Its stop and response gate inject network
failure and a commit/ack crash window; it does not fabricate service responses.
"""
from __future__ import annotations

import base64
from concurrent.futures import ThreadPoolExecutor
import http.cookiejar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from privatespace_sync.engine import Engine, configure
from privatespace_sync.filesystem import digest, valid_path
from privatespace_sync.transport import Remote, SyncError
from privatespace_sync.watcher import DirectoryWatcher
from full_disk import check_full_disk

BACKEND = os.environ["NOTES_BACKEND"]
ORIGIN = "http://127.0.0.1:" + os.environ["NOTES_FRONTEND_PORT"]
OUTPUT = Path(os.environ["M0_SYNC_OUTPUT"]).absolute()
OUTPUT.mkdir(parents=True, exist_ok=True)
assert OUTPUT.is_relative_to(Path(__file__).resolve().parents[2] / "frontend" / "test-results")


class Web:
    def __init__(self):
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, path, body=None, *, method=None):
        headers = {"Origin": ORIGIN, "Content-Type": "application/json", "Idempotency-Key": str(__import__('uuid').uuid4())}
        if body is not None or method:
            token = self.request("/auth/csrf")["token"]
            headers["X-CSRF-TOKEN"] = token
        request = urllib.request.Request(BACKEND + "/api/v1" + path, headers=headers,
                                        data=json.dumps(body).encode() if body is not None else None, method=method)
        with self.opener.open(request, timeout=15) as response:
            return json.load(response)


class Relay:
    def __init__(self, port=0):
        relay = self
        self.committed = threading.Event()
        self.release = threading.Event()
        self.gate_next_write = False

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.forward()

            def do_POST(self):
                self.forward()

            def forward(self):
                size = int(self.headers.get("Content-Length", 0))
                payload = self.rfile.read(size) if size else None
                headers = {key: value for key, value in self.headers.items() if key.lower() not in ("host", "connection", "content-length")}
                request = urllib.request.Request(BACKEND + self.path, data=payload, headers=headers, method=self.command)
                try:
                    response = urllib.request.urlopen(request, timeout=20)
                except urllib.error.HTTPError as error:
                    response = error
                except OSError:
                    self.connection.close(); return
                with response:
                    data = response.read()
                    if relay.gate_next_write and self.command == "POST" and self.path == "/api/v1/sync/files" and response.status == 200:
                        relay.gate_next_write = False
                        relay.committed.set()
                        relay.release.wait(timeout=25)
                        self.connection.close(); return
                    self.send_response(response.status)
                    for key, value in response.headers.items():
                        if key.lower() not in ("transfer-encoding", "connection", "content-length"):
                            self.send_header(key, value)
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header("Connection", "close")
                    self.end_headers()
                    try:
                        self.wfile.write(data)
                    except (BrokenPipeError, ConnectionError):
                        pass  # Deliberately terminated clients are part of the crash scenario.

        class Server(ThreadingHTTPServer):
            allow_reuse_address = True
            daemon_threads = True
        self.server = Server(("127.0.0.1", port), Handler)
        self.port = self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.release.set()
        self.server.shutdown(); self.server.server_close(); self.thread.join()


def cli(state: Path, *, wait=True):
    executable = os.environ.get("M0_SYNC_EXECUTABLE")
    command = [executable] if executable else [sys.executable, "-m", "privatespace_sync"]
    process = subprocess.Popen([*command, "once", "--state", str(state)],
                               cwd=Path(__file__).resolve().parents[1], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if not wait:
        return process
    output, error = process.communicate(timeout=35)
    assert not error, "CLI emitted an unexpected error"
    return process.returncode, json.loads(output)


def engine(state):
    return Engine(state, stable_seconds=.03, delete_grace=0)


def pair(web, relay, label):
    code = web.request("/sync-devices/pairing-code", {"name": "M0-" + label})["code"]
    root = OUTPUT / ("vault-" + label)
    state = OUTPUT / ("state-" + label)
    result = configure("http://127.0.0.1:" + str(relay.port), root, state, code)
    try:
        Remote(BACKEND).request("/pair", body={"code": code})
        raise AssertionError("Pairing code was reusable")
    except SyncError as error:
        assert error.status == 401
    return root, state, result["device"]


def settle(agent):
    result = agent.cycle()
    assert result["status"] == "OK", result
    return result


def write(web):
    relay = Relay()
    a = b = None
    results = []
    try:
        root_a, state_a, device_a = pair(web, relay, "A")
        root_b, state_b, device_b = pair(web, relay, "B")
        a, b = engine(state_a), engine(state_b)
        settle(a); settle(b)
        # The device token cannot enter the cookie-authenticated note/account routes.
        token = a.remote.token
        tokens = (a.remote.token, b.remote.token)
        for path in ("/api/v1/notes", "/api/v1/sync-devices", "/api/v1/files/content?path=private.md"):
            try:
                urllib.request.urlopen(urllib.request.Request(BACKEND + path, headers={"Authorization": "Bearer " + token}))
                raise AssertionError("Device token escaped sync scope")
            except urllib.error.HTTPError as error:
                assert error.code == 401
        try:
            a.remote.request("/files", body={"id": None, "path": "摘要拒绝.bin", "baseVersion": "0", "deleted": False,
                                             "sha256": "0" * 64, "contentBase64": base64.b64encode(b"wrong digest fixture").decode()},
                             operation=str(__import__('uuid').uuid4()))
            raise AssertionError("Mismatched upload digest was accepted")
        except SyncError as error:
            assert error.code == "CHECKSUM_MISMATCH" and error.status == 400
        assert not any(file["path"] == "摘要拒绝.bin" for file in a.snapshot().values())
        note = "M0验证/中文 & [特殊].md"
        initial = '\uFEFF---\r\ntitle: "兼容 📝"\r\ncustom: "A & B"\r\n---\r\n# 中文标题\r\n[[保留双链]]\r\n![相对图片](assets/图.png)\r\n'.encode()
        path_a = root_a / note
        path_a.parent.mkdir()
        path_a.write_bytes(initial)
        image_path = root_a / "M0验证/assets/图.png"
        image_path.parent.mkdir()
        image = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
        image_path.write_bytes(image)
        watcher = DirectoryWatcher(root_a)
        try:
            time.sleep(.1)
            temporary = path_a.with_suffix(".tmp")
            temporary.write_bytes(initial + "\r\n临时文件替换保存。\r\n".encode())
            os.replace(temporary, path_a)
            assert watcher.event.wait(4), "No Windows directory notification"
            assert watcher.notifications > 0
        finally:
            watcher.close()
        settle(a); settle(b)
        assert (root_b / note).read_bytes() == path_a.read_bytes()
        assert (root_b / "M0验证/assets/图.png").read_bytes() == image
        assert not any(item["path"].endswith(".tmp") for item in a.snapshot().values())
        results.append("windows-notifications-and-byte-roundtrip")

        # Two independently opened SQLite clients submit from the same shared baseline concurrently.
        path_a.write_bytes(b"A concurrent version\r\n")
        (root_b / note).write_bytes(b"B concurrent version\r\n")
        a.close(); b.close(); a = b = None
        barrier = threading.Barrier(2)
        def concurrent(state):
            instance = engine(state)
            try:
                barrier.wait(timeout=5)
                return instance.cycle()
            finally:
                instance.close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(concurrent, (state_a, state_b)))
        assert sum(any(conflict["path"] == note for conflict in outcome["conflicts"]) for outcome in outcomes) == 1, outcomes
        a, b = engine(state_a), engine(state_b)
        remote_note = next(item for item in a.snapshot().values() if item["path"] == note)
        variants = {a.download(remote_note)}
        for root in (root_a, root_b):
            variants.update(copy.read_bytes() for copy in (root / "M0验证").glob("*conflict*.md"))
        assert {b"A concurrent version\r\n", b"B concurrent version\r\n"}.issubset(variants)
        results.append("concurrent-clients-preserve-both")

        binary_name = "并发附件.bin"
        (root_a / binary_name).write_bytes(b"\x00\xffbinary baseline")
        settle(a); settle(b)
        (root_a / binary_name).write_bytes(b"\x00\xffbinary A")
        (root_b / binary_name).write_bytes(b"\x00\xfebinary B")
        a.close(); b.close(); a = b = None
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(concurrent, (state_a, state_b)))
        assert sum(any(conflict["path"] == binary_name for conflict in outcome["conflicts"]) for outcome in outcomes) == 1
        a, b = engine(state_a), engine(state_b)
        remote_binary = next(item for item in a.snapshot().values() if item["path"] == binary_name)
        binary_variants = {a.download(remote_binary)}
        for root in (root_a, root_b):
            binary_variants.update(copy.read_bytes() for copy in root.glob("并发附件 (conflict-*).bin"))
        assert {b"\x00\xffbinary A", b"\x00\xfebinary B"}.issubset(binary_variants)
        results.append("binary-attachment-concurrent-conflict")

        offline = root_a / "离线.md"
        offline.write_bytes(b"offline baseline")
        settle(a); settle(b)
        relay_port = relay.port
        relay.close()
        offline.write_bytes(b"offline durable edit")
        assert a.cycle()["code"] == "NETWORK_UNAVAILABLE"
        assert a.status()["queued"] > 0
        a.close(); a = None
        code, status = cli(state_a)
        assert code == 2 and status["code"] == "NETWORK_UNAVAILABLE"
        relay = Relay(relay_port)
        code, status = cli(state_a)
        assert code == 0 and status["queued"] == 0, status
        a = engine(state_a)
        settle(b)
        assert (root_b / "离线.md").read_bytes() == b"offline durable edit"
        results.append("real-disconnect-persistent-queue-process-restart")

        # Kill a real helper process after the backend committed, before its ack reaches SQLite.
        offline.write_bytes(b"committed before crash")
        relay.gate_next_write = True
        a.close(); a = None
        child = cli(state_a, wait=False)
        assert relay.committed.wait(20), "No backend commit before crash"
        child.terminate(); child.communicate(timeout=10)
        relay.release.set()
        code, status = cli(state_a)
        assert code == 0 and status["queued"] == 0, status
        a = engine(state_a)
        settle(b)
        assert (root_b / "离线.md").read_bytes() == b"committed before crash"
        results.append("real-process-kill-after-server-commit")

        # Delete/modify conflict: the modified bytes survive a real server tombstone.
        deletion = root_a / "删除冲突.md"
        deletion.write_bytes(b"delete baseline")
        settle(a); settle(b)
        deletion.unlink()
        (root_b / "删除冲突.md").write_bytes(b"modified while other end deleted")
        a.cycle()
        preview = a.cycle()
        if preview["status"] == "REQUIRES_CONFIRMATION":
            assert a.cycle(confirmation=preview["deletionPreview"]["fingerprint"])["status"] == "OK"
        outcome = b.cycle()
        assert any(conflict["path"] == "删除冲突.md" for conflict in outcome["conflicts"]), outcome
        assert (root_b / "删除冲突.md").read_bytes() == b"modified while other end deleted"
        assert next(item for item in a.snapshot().values() if item["path"] == "删除冲突.md")["deleted"]
        results.append("delete-modify-conflict-preserves-content")

        # More than twenty destructive operations require the exact reviewed fingerprint.
        batch = root_a / "批量保护"
        batch.mkdir()
        for index in range(21):
            (batch / f"{index}.md").write_text(f"batch-{index}", encoding="utf-8")
        settle(a); settle(b)
        for file in batch.iterdir():
            file.unlink()
        a.cycle()
        preview = a.cycle()
        assert preview["status"] == "REQUIRES_CONFIRMATION", preview
        assert len(preview["deletionPreview"]["changes"]) == 21
        assert all(not item["deleted"] for item in a.snapshot().values() if item["path"].startswith("批量保护/"))
        (batch / "0.md").write_text("batch-0", encoding="utf-8")
        outdated = a.cycle(confirmation=preview["deletionPreview"]["fingerprint"])
        assert outdated["status"] == "REQUIRES_CONFIRMATION"
        assert a.cycle(confirmation=outdated["deletionPreview"]["fingerprint"])["status"] == "OK"
        other = b.cycle()
        assert other["status"] == "REQUIRES_CONFIRMATION", other
        assert len(list((root_b / "批量保护").glob("*.md"))) == 21
        assert b.cycle(confirmation=other["deletionPreview"]["fingerprint"])["status"] == "OK"
        assert len(list((state_b / "recycle").glob("*.bin"))) >= 20
        results.append("concrete-bulk-delete-preview-and-local-recycle")

        # Whole-root disappearance and a replacement empty directory never propagate deletions.
        moved_root = root_a.with_name(root_a.name + "-disconnected")
        root_a.rename(moved_root)
        try:
            assert a.cycle()["status"] == "PAUSED"
            root_a.mkdir()
            assert a.cycle()["status"] == "PAUSED"
            root_a.rmdir()
        finally:
            moved_root.rename(root_a)
        settle(a)
        results.append("missing-root-and-root-binding")

        # A real Windows directory junction is reported; no file under its target is uploaded.
        outside = OUTPUT / "outside"
        outside.mkdir()
        (outside / "never-upload.txt").write_text("M0 out-of-root fixture", encoding="utf-8")
        junction = root_a / "external-junction"
        linked = subprocess.run(["cmd", "/c", "mklink", "/J", str(junction), str(outside)], capture_output=True)
        assert linked.returncode == 0, "Could not create test-owned junction"
        outcome = a.cycle()
        assert any(issue["code"] == "UNSAFE_LINK" for issue in outcome["issues"])
        assert not any("never-upload" in item["path"] for item in a.snapshot().values())
        assert not valid_path("../escape.md") and not valid_path("CON.md")
        results.append("junction-exclusion-and-windows-paths")

        # Leave a dedicated ordinary-file corpus for the separate Obsidian UI acceptance.
        compatibility = root_a / "Obsidian验收/中文 & 特殊.md"
        compatibility.parent.mkdir()
        assets = compatibility.parent / "assets"
        assets.mkdir()
        corpus = ('\uFEFF---\r\ntitle: "兼容 📝"\r\ncustom: "A & B"\r\n---\r\n# 文件兼容验收\r\n'
                  '\r\n[[保留双链]]\r\n\r\n![相对图片](assets/可视验收图.png)\r\n\r\n'
                  '| 中文 | 特殊字符 |\r\n| --- | --- |\r\n| 📝 | & [] |\r\n\r\n'
                  '- [x] 已完成项目\r\n\r\n```python\r\nprint("中文")\r\n```\r\n').encode()
        compatibility.write_bytes(corpus)
        visible_image = Path(__file__).with_name("fixtures") / "visual-check.png"
        (assets / "可视验收图.png").write_bytes(visible_image.read_bytes())
        settle(a); settle(b)
        assert (root_b / "Obsidian验收/中文 & 特殊.md").read_bytes() == corpus
        download = urllib.request.Request(BACKEND + '/api/v1/files/content?path=' + urllib.parse.quote('Obsidian验收/中文 & 特殊.md'))
        with web.opener.open(download, timeout=10) as response:
            assert response.read() == corpus
        (OUTPUT / "compatibility-original.md").write_bytes(corpus)
        (OUTPUT / "compatibility.json").write_text(json.dumps({"sha256": digest(corpus), "webAndWindowsBytesEqual": True,
                                                               "obsidianUiVerified": False, "vault": str(root_b)}, ensure_ascii=False, indent=2), encoding="utf-8")
        results.append("web-windows-frontmatter-bom-crlf-relative-image-corpus")

        manual_vault = os.environ.get("M0_OBSIDIAN_VAULT")
        if manual_vault:
            supplied = Path(manual_vault).resolve()
            expected = Path(__file__).resolve().parents[2] / "data/m0-obsidian-vault"
            assert supplied == expected.resolve(), "Only the dedicated manual acceptance directory may be imported"
            manual = (supplied / "中文 & 特殊.md").read_bytes()
            body = manual.decode("utf-8")
            assert "## Obsidian 手动验证" in body and "这段内容由我在 Obsidian 中添加。" in body
            assert 'title: "兼容 📝"' in body and 'custom: "A & B"' in body
            assert "![相对图片](assets/可视验收图.png)" in body
            assert (supplied / "assets/可视验收图.png").read_bytes() == visible_image.read_bytes()
            compatibility.write_bytes(manual)
            settle(a); settle(b)
            assert (root_b / "Obsidian验收/中文 & 特殊.md").read_bytes() == manual
            with web.opener.open(download, timeout=10) as response:
                assert response.read() == manual
            (OUTPUT / "obsidian-manual.json").write_text(json.dumps({
                "userConfirmedManualEditing": True, "editedMarkerPresent": True,
                "frontmatterAndRelativeImageRetained": True, "editedFileSha256": digest(manual),
                "startsWithBom": manual.startswith(b"\xef\xbb\xbf"), "crlfCount": manual.count(b"\r\n"),
                "webAndSecondWindowsDirectoryBytesEqual": True,
            }, indent=2), encoding="utf-8")
            results.append("user-edited-obsidian-file-real-web-and-windows-roundtrip")

        if os.environ.get("M0_FULL_DISK_IMAGE"):
            check_full_disk(a.remote, OUTPUT)
            results.append("real-kernel-disk-full-507-and-previous-version")

        for state in (state_a, state_b):
            for file in state.iterdir():
                if file.is_file():
                    assert all(value.encode() not in file.read_bytes() for value in tokens), "Device token leaked to durable plaintext"
        # Retain only non-secret references for the next independent server context.
        (OUTPUT / "state.json").write_text(json.dumps({"stateA": str(state_a), "stateB": str(state_b), "deviceA": device_a,
                                                       "deviceB": device_b, "offline": "离线.md", "proxyPort": relay.port}), encoding="utf-8")
        (OUTPUT / "write.json").write_text(json.dumps({"checks": results, "rootA": str(root_a), "rootB": str(root_b)}, ensure_ascii=False, indent=2), encoding="utf-8")
    finally:
        if a: a.close()
        if b: b.close()
        relay.close()


def restore(web):
    saved = json.loads((OUTPUT / "state.json").read_text(encoding="utf-8"))
    relay = Relay(saved["proxyPort"])
    a = engine(Path(saved["stateA"]))
    try:
        assert a.cycle()["status"] == "OK"
        file = next(item for item in a.snapshot().values() if item["path"] == saved["offline"])
        assert a.download(file) == b"committed before crash"
        web.request("/sync-devices/" + saved["deviceA"], method="DELETE")
        result = a.cycle()
        assert result["status"] == "PAUSED" and result["code"] == "DEVICE_UNAUTHORIZED", result
        (OUTPUT / "restore.json").write_text(json.dumps({"serverRestart": True, "revokedTokenRejected": True}), encoding="utf-8")
    finally:
        a.close(); relay.close()


if __name__ == "__main__":
    web = Web()
    web.request("/auth/login", {"username": "notes-it", "password": os.environ["NOTES_PASSWORD"]})
    if sys.argv[1] == "write":
        write(web)
    else:
        restore(web)
    print("PASS: sync-" + sys.argv[1])
