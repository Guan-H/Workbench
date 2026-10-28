"""Real filesystem operations with root binding, stable reads and atomic publication."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import tempfile
import unicodedata

from .transport import SyncError

MARKER = ".private-space-root"
EXCLUDED = {".git", ".obsidian", ".privatespace", ".private-space-root", "__pycache__", "node_modules"}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def valid_path(path: str) -> bool:
    try:
        units = len(path.encode("utf-16-le")) // 2
        path.encode("utf-8")
    except UnicodeEncodeError:
        return False
    if not path or units > 240 or unicodedata.normalize("NFC", path) != path or "\\" in path:
        return False
    for part in path.split("/"):
        if (not part or part in (".", "..") or part.endswith((".", " ")) or part.casefold() in EXCLUDED
                or re.search(r'[<>:"|?*\x00-\x1f]', part)
                or re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?", part)):
            return False
    return True


def excluded(path: str) -> bool:
    return (any(part.casefold() in EXCLUDED for part in path.split("/"))
            or path.endswith((".tmp", ".swp", ".swx", "~")) or Path(path).name.startswith(("~$", ".upload-")))


class Filesystem:
    def __init__(self, root: Path, identity: str):
        self.root = root
        self.identity = identity

    def ready(self):
        if any(path.is_symlink() or path.is_junction() for path in (self.root, *self.root.parents)) or not self.root.is_dir():
            raise SyncError("ROOT_UNAVAILABLE")
        marker = self.root / MARKER
        if marker.is_symlink() or marker.is_junction() or marker.read_text(encoding="ascii") != self.identity:
            raise SyncError("ROOT_IDENTITY_MISMATCH")

    def path(self, relative: str, *, parents: bool = False) -> Path:
        self.ready()
        if not valid_path(relative):
            raise SyncError("INVALID_PATH")
        target = self.root
        parts = relative.split("/")
        for index, part in enumerate(parts):
            target = target / part
            if target.is_symlink() or target.is_junction():
                raise SyncError("UNSAFE_LINK")
            if parents and index < len(parts) - 1:
                target.mkdir(exist_ok=True)
        return target

    def read(self, relative: str) -> bytes | None:
        target = self.path(relative)
        try:
            before = target.stat()
            if before.st_size > (1024 * 1024 if relative.endswith(".md") else 50 * 1024 * 1024):
                raise SyncError("FILE_TOO_LARGE")
            data = target.read_bytes()
            after = target.stat()
        except FileNotFoundError:
            return None
        if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
            raise SyncError("FILE_BUSY")
        return data

    def scan(self) -> tuple[dict[str, str], list[dict]]:
        self.ready()
        files: dict[str, str] = {}
        names: set[str] = set()
        issues = []
        def fail(error):
            raise SyncError("DIRECTORY_UNAVAILABLE") from error
        for directory, dirs, filenames in os.walk(self.root, followlinks=False, onerror=fail):
            parent = Path(directory)
            safe_dirs = []
            for name in dirs:
                relative = (parent / name).relative_to(self.root).as_posix()
                if excluded(relative):
                    continue
                if (parent / name).is_symlink() or (parent / name).is_junction():
                    issues.append({"path": relative, "code": "UNSAFE_LINK"})
                elif valid_path(relative):
                    safe_dirs.append(name)
                else:
                    issues.append({"path": relative, "code": "INVALID_PATH"})
            dirs[:] = safe_dirs
            for name in filenames:
                relative = (parent / name).relative_to(self.root).as_posix()
                if excluded(relative):
                    continue
                if not valid_path(relative) or relative.casefold() in names:
                    issues.append({"path": relative, "code": "INVALID_PATH"}); continue
                names.add(relative.casefold())
                try:
                    data = self.read(relative)
                    if data is not None:
                        files[relative] = digest(data)
                except (SyncError, OSError) as error:
                    issues.append({"path": relative, "code": error.code if isinstance(error, SyncError) else "FILE_UNAVAILABLE"})
        self.ready()
        return files, issues

    def atomic(self, relative: str, data: bytes, expected: str | None):
        target = self.path(relative, parents=True)
        descriptor, temporary = tempfile.mkstemp(prefix=".upload-", suffix=".tmp", dir=target.parent)
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(data); output.flush(); os.fsync(output.fileno())
            current = self.read(relative)
            if (digest(current) if current is not None else None) != expected:
                raise SyncError("LOCAL_CHANGED_DURING_DOWNLOAD")
            self.path(relative)
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
