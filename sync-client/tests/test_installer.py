import json
from pathlib import Path
import tempfile
import unittest

from privatespace_sync.installer import EXECUTABLE, SHORTCUT, install_bundle, read_shortcut, save_shortcut


class InstallerTests(unittest.TestCase):
    def fixture(self, base):
        source = base / '解压目录'
        (source / '_internal').mkdir(parents=True)
        (source / EXECUTABLE).write_bytes(b'unit fixture, not a runnable application')
        (source / '_internal/runtime.bin').write_bytes(b'copied runtime fixture')
        return source, base / 'Programs' / 'PrivateSpaceSync', (base / '桌面', base / '开始菜单')

    def test_complete_copy_and_real_shortcuts_update_without_removing_old_version(self):
        with tempfile.TemporaryDirectory() as temporary:
            source, root, folders = self.fixture(Path(temporary))
            target, links = install_bundle(source, root, folders=folders)
            self.assertEqual(target.read_bytes(), (source / EXECUTABLE).read_bytes())
            self.assertEqual((target.parent / '_internal/runtime.bin').read_bytes(), b'copied runtime fixture')
            for link in links:
                self.assertEqual(Path(read_shortcut(link)['target']), target)
            second, _ = install_bundle(source, root, folders=folders)
            self.assertNotEqual(target, second)
            self.assertTrue(target.exists())
            self.assertEqual(json.loads((root / 'install.json').read_text())['executable'], second.relative_to(root).as_posix())

    def test_incomplete_package_and_unmanaged_target_preserve_existing_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            source, root, folders = self.fixture(Path(temporary))
            (source / EXECUTABLE).unlink()
            with self.assertRaises(ValueError):
                install_bundle(source, root, folders=folders)
            self.assertFalse(root.exists())
            (source / EXECUTABLE).write_bytes(b'unit fixture')
            root.mkdir(parents=True); (root / '用户文件.txt').write_bytes(b'preserve')
            with self.assertRaises(ValueError):
                install_bundle(source, root, folders=folders)
            self.assertEqual((root / '用户文件.txt').read_bytes(), b'preserve')

    def test_copy_interruption_preserves_previous_metadata_and_shortcuts(self):
        with tempfile.TemporaryDirectory() as temporary:
            source, root, folders = self.fixture(Path(temporary))
            target, links = install_bundle(source, root, folders=folders)
            original = (root / 'install.json').read_bytes()
            link_bytes = [link.read_bytes() for link in links]
            def interrupt(*_):
                raise OSError('explicit copy-interruption injection')
            with self.assertRaises(OSError):
                install_bundle(source, root, folders=folders, progress=interrupt)
            self.assertEqual((root / 'install.json').read_bytes(), original)
            self.assertEqual([link.read_bytes() for link in links], link_bytes)
            self.assertTrue(target.exists())

    def test_unrelated_shortcut_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as temporary:
            source, root, folders = self.fixture(Path(temporary))
            folders[0].mkdir()
            shortcut = folders[0] / SHORTCUT
            save_shortcut(shortcut, source / EXECUTABLE)
            before = shortcut.read_bytes()
            with self.assertRaises(ValueError):
                install_bundle(source, root, folders=folders)
            self.assertEqual(shortcut.read_bytes(), before)
