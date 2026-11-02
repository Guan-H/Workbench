from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from privatespace_sync.state_lock import StateLock


class StateLockTests(unittest.TestCase):
    def test_other_process_cannot_write_until_owner_exits(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'state'
            script = (
                "from pathlib import Path; from privatespace_sync.state_lock import StateLock; "
                "from privatespace_sync.transport import SyncError; import sys\n"
                "try:\n with StateLock(Path(sys.argv[1])): print('ACQUIRED')\n"
                "except SyncError as error: print(error.code)\n"
            )
            def child():
                return subprocess.run([sys.executable, '-c', script, str(state)], check=True, capture_output=True, text=True).stdout.strip()
            with StateLock(state):
                self.assertEqual(child(), 'STATE_IN_USE')
            self.assertEqual(child(), 'ACQUIRED')
