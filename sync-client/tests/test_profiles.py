import json
from pathlib import Path
import tempfile
import unittest

from privatespace_sync.profiles import Profiles
from privatespace_sync.transport import SyncError


class ProfileTests(unittest.TestCase):
    def test_legacy_is_unchanged_and_selection_survives_restart(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / 'state'
            state.mkdir()
            original = b'{"url":"https://example.invalid","root":"D:/legacy"}'
            (state / 'config.json').write_bytes(original)
            profiles = Profiles(state)
            try:
                identity = profiles.create('第二套配置')
                self.assertEqual((state / 'config.json').read_bytes(), original)
                self.assertNotEqual(profiles.path(identity), state)
            finally:
                profiles.close()
            profiles = Profiles(state)
            try:
                self.assertEqual(profiles.active, identity)
                profiles.activate('default')
                self.assertEqual(profiles.entries()[0]['url'], 'https://example.invalid')
            finally:
                profiles.close()

    def test_names_and_missing_selection_do_not_change_persisted_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            profiles = Profiles(Path(temporary) / 'state')
            try:
                identity = profiles.create('正常配置')
                before = (profiles.directory / 'registry.json').read_bytes()
                for action in (lambda: profiles.create(' '), lambda: profiles.activate('missing')):
                    with self.assertRaises(SyncError):
                        action()
                    self.assertEqual(profiles.active, identity)
                    self.assertEqual((profiles.directory / 'registry.json').read_bytes(), before)
            finally:
                profiles.close()

    def test_sync_roots_cannot_overlap_any_saved_profile_or_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            state = base / 'state'; state.mkdir()
            root = base / 'existing-vault'
            (state / 'config.json').write_text(json.dumps({'root': str(root), 'url': 'https://example.invalid'}))
            profiles = Profiles(state)
            try:
                for target in (root, root / 'child', base, state / 'child', profiles.directory):
                    with self.assertRaises(SyncError):
                        profiles.validate_root(target)
                profiles.validate_root(base / 'new-vault')
            finally:
                profiles.close()

    def test_another_manager_cannot_switch_the_same_registry(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / 'state'
            profiles = Profiles(state)
            try:
                with self.assertRaises(SyncError) as error:
                    Profiles(state)
                self.assertEqual(error.exception.code, 'STATE_IN_USE')
            finally:
                profiles.close()
