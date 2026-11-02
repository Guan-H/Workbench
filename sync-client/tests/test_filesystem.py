from __future__ import annotations

import os
from pathlib import Path
import tempfile
import unittest
import uuid

from privatespace_sync.credentials import protect
from privatespace_sync.filesystem import Filesystem, MARKER, digest, valid_path
from privatespace_sync.transport import SyncError


class FilesystemTests(unittest.TestCase):
    def test_materializes_nested_empty_directories_without_overwriting_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            identity = str(uuid.uuid4())
            (root / MARKER).write_text(identity, encoding='ascii')
            fs = Filesystem(root, identity)
            fs.ensure_directory('工作/空目录/子目录')
            fs.ensure_directory('工作/空目录/子目录')
            self.assertTrue((root / '工作/空目录/子目录').is_dir())
            (root / '同名').write_bytes(b'preserve')
            with self.assertRaisesRegex(SyncError, 'DIRECTORY_PATH_CONFLICT'):
                fs.ensure_directory('同名/子目录')
            self.assertEqual((root / '同名').read_bytes(), b'preserve')

    def test_missing_directory_with_known_children_is_not_recreated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            identity = str(uuid.uuid4())
            (root / MARKER).write_text(identity, encoding='ascii')
            with self.assertRaisesRegex(SyncError, 'PARENT_DIRECTORY_UNAVAILABLE'):
                Filesystem(root, identity).ensure_directory('失联/原目录', has_baseline=True)
            self.assertFalse((root / '失联').exists())

    def test_atomic_publication_does_not_overwrite_an_edit_after_download_baseline(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            identity = str(uuid.uuid4())
            (root / MARKER).write_text(identity, encoding="ascii")
            fs = Filesystem(root, identity)
            fs.atomic("中文.md", b"confirmed", None)
            (root / "中文.md").write_bytes(b"new local edit")
            with self.assertRaisesRegex(SyncError, "LOCAL_CHANGED_DURING_DOWNLOAD"):
                fs.atomic("中文.md", b"downloaded", digest(b"confirmed"))
            self.assertEqual((root / "中文.md").read_bytes(), b"new local edit")
            self.assertEqual(list(root.glob("*.tmp")), [])

    def test_paths_share_backend_utf16_limit_and_exclude_windows_reserved_names(self):
        self.assertTrue(valid_path("中文 & [特殊]/笔记.md"))
        for path in ("../escape.md", "CON.md", "a/.obsidian/config", "a/..", "a\\b.md", "📝" * 120 + ".md"):
            self.assertFalse(valid_path(path), path)

    @unittest.skipUnless(os.name == "nt", "Windows DPAPI test requires Windows")
    def test_real_dpapi_roundtrip_and_tamper_rejection(self):
        value = os.urandom(32)
        encrypted = protect(value)
        self.assertNotIn(value, encrypted)
        self.assertEqual(protect(encrypted, decrypt=True), value)
        corrupted = bytearray(encrypted)
        corrupted[-1] ^= 1
        with self.assertRaises(OSError):
            protect(bytes(corrupted), decrypt=True)
