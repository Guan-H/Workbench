import unittest
import tempfile
import uuid
from pathlib import Path
from privatespace_sync.filesystem import Filesystem, MARKER
from privatespace_sync.scope import SyncScope
from privatespace_sync.transport import SyncError


class ScopeTests(unittest.TestCase):
    def test_real_scanner_does_not_read_or_report_unselected_oversized_note(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            identity = str(uuid.uuid4())
            (root / MARKER).write_text(identity, encoding='ascii')
            for folder in ('工作', '其他', '共享'):
                (root / folder).mkdir()
            (root / '工作/笔记.md').write_bytes(b'# selected\n')
            (root / '共享/图.bin').write_bytes(b'attachment')
            (root / '共享/无关.md').write_bytes(b'x' * (1024 * 1024 + 1))
            (root / '其他/超限.md').write_bytes(b'x' * (1024 * 1024 + 1))
            scope = SyncScope({'all': False, 'folders': ['工作']}, ['共享/图.bin'])
            files, issues = Filesystem(root, identity).scan(include=scope.includes, descend=scope.descends)
            self.assertEqual(set(files), {'工作/笔记.md', '共享/图.bin'})
            self.assertEqual(issues, [])

    def test_roots_are_segment_bounded_and_dependencies_do_not_select_siblings(self):
        scope = SyncScope({'all': False, 'folders': ['工作/项目A', '个人']}, ['公共/图.png'])
        self.assertTrue(scope.includes('工作/项目A/子目录/笔记.md'))
        self.assertTrue(scope.includes('公共/图.png'))
        self.assertTrue(scope.descends('工作'))
        self.assertTrue(scope.descends('公共'))
        self.assertFalse(scope.includes('工作/项目AB/笔记.md'))
        self.assertFalse(scope.includes('公共/其他.png'))
        self.assertFalse(scope.explicit('公共/图.png'))
        self.assertFalse(scope.descends('无关目录'))
        self.assertTrue(scope.directory('工作/项目A'))
        self.assertTrue(scope.directory('工作/项目A/空目录'))
        self.assertFalse(scope.directory('工作'))
        self.assertFalse(scope.directory('公共'))

    def test_invalid_empty_or_escaping_selections_fail_at_boundary(self):
        for scope in ({'all': False, 'folders': []}, {'all': True, 'folders': ['工作']},
                      {'all': False, 'folders': ['../工作']}, {'all': 'true', 'folders': []}):
            with self.assertRaises(SyncError):
                SyncScope(scope)
        self.assertTrue(SyncScope().includes('任意/笔记.md'))
