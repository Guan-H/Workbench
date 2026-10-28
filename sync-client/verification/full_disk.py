"""Fill only a test-owned Docker tmpfs, then exercise the real product API."""

from __future__ import annotations

import base64
import json
import io
import os
from pathlib import Path
import re
import subprocess
import time
import tarfile
import urllib.error
import urllib.request
import uuid

from privatespace_sync.filesystem import digest
from privatespace_sync.transport import Remote, SyncError


def check_full_disk(remote: Remote, output: Path):
    image = os.environ.get("M0_FULL_DISK_IMAGE", "")
    if not re.fullmatch(r"eclipse-temurin@sha256:[a-f0-9]{64}", image):
        raise AssertionError("A pinned official Java image is required for the real disk-full test")
    storage = Path(os.environ["M0_STORAGE_PATH"]).absolute()
    jar = Path(__file__).resolve().parents[2] / "backend/target/private-space-backend-0.1.0-SNAPSHOT.jar"
    assert jar.is_file() and storage.is_dir()
    assert os.environ["IT_DB_URL"].split("/", 3)[3].split("?")[0] == "private_space_it"
    initial = b"M0 disk-full original bytes"
    file = remote.request("/files", body={"path": "磁盘满验证.bin", "id": None, "baseVersion": "0", "deleted": False,
                                         "sha256": digest(initial), "contentBase64": base64.b64encode(initial).decode()}, operation=str(uuid.uuid4()))
    name = "private-space-m0-full-" + uuid.uuid4().hex[:12]
    environment = os.environ.copy()
    environment.update(DB_URL="jdbc:mysql://mysql:3306/private_space_it?useUnicode=true&characterEncoding=utf8&serverTimezone=UTC",
                       DB_USERNAME=os.environ["IT_DB_USERNAME"], DB_PASSWORD=os.environ["IT_DB_PASSWORD"])
    def docker(*arguments, check=True):
        result = subprocess.run(["docker", *arguments], env=environment, capture_output=True, text=True, timeout=90)
        if check and result.returncode:
            raise AssertionError("Docker test operation failed: " + result.stderr[-1500:])
        return result
    try:
        docker("run", "-d", "--name", name, "--label", "com.privatespace.m0=true", "--network", "private-space-integration_default",
               "--read-only", "--tmpfs", "/tmp:rw,size=64m", "--tmpfs", "/objects:rw,size=24m", "--publish", "127.0.0.1::8080",
               "--mount", f"type=bind,source={jar},target=/app.jar,readonly",
               "--env", "DB_URL", "--env", "DB_USERNAME", "--env", "DB_PASSWORD", "--env", "SERVER_ADDRESS=0.0.0.0",
               "--env", "PRIVATE_SPACE_STORAGE_PATH=/objects", image, "java", "-Xmx192m", "-jar", "/app.jar")
        binding = docker("port", name, "8080").stdout.strip()
        assert re.fullmatch(r"127\.0\.0\.1:\d+", binding)
        url = "http://" + binding
        ready = False
        for _ in range(50):
            try:
                with urllib.request.urlopen(url + "/api/system/health/readiness", timeout=2) as response:
                    ready = response.status == 200
                    if ready: break
            except (OSError, urllib.error.URLError):
                time.sleep(.5)
        assert ready, "Temporary disk-full backend did not become ready"
        # All existing object references still point at real copied bytes in the bounded volume.
        archive_bytes = io.BytesIO()
        with tarfile.open(fileobj=archive_bytes, mode="w") as archive:
            for source in storage.rglob("*"):
                assert not source.is_symlink()
                if source.is_file():
                    archive.add(source, arcname=source.relative_to(storage).as_posix(), recursive=False)
        copied = subprocess.run(["docker", "exec", "-i", name, "tar", "xf", "-", "-C", "/objects"],
                                input=archive_bytes.getvalue(), capture_output=True, timeout=30)
        assert copied.returncode == 0, "Could not populate the private tmpfs object volume"
        full = docker("exec", name, "sh", "-c", "dd if=/dev/zero of=/objects/.m0-fill bs=1048576", check=False)
        assert full.returncode != 0 and "no space left" in full.stderr.lower(), "The kernel did not report ENOSPC"
        server = Remote(url, remote.token)
        replacement = b"must not replace confirmed content"
        try:
            server.request("/files", body={"path": file["path"], "id": file["id"], "baseVersion": file["version"], "deleted": False,
                                           "sha256": digest(replacement), "contentBase64": base64.b64encode(replacement).decode()}, operation=str(uuid.uuid4()))
            raise AssertionError("Disk-full write was accepted")
        except SyncError as error:
            assert error.status == 507 and error.code == "INSUFFICIENT_STORAGE"
        current = next(item for item in server.request("/snapshot")["items"] if item["id"] == file["id"])
        assert current["version"] == file["version"]
        assert server.request(f'/files/{file["id"]}?version={file["version"]}', binary=True) == initial
        (output / "disk-full.json").write_text(json.dumps({"kernelEnospc": True, "rejectedHttpStatus": 507,
                                                          "confirmedVersionReadable": True, "image": image}, indent=2), encoding="utf-8")
    finally:
        docker("rm", "-f", name)
