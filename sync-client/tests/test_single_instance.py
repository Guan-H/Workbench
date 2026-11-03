from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

from privatespace_sync.single_instance import SingleInstance, bind_activation


class SingleInstanceTests(unittest.TestCase):
    def launch(self, state):
        code = ('from pathlib import Path; import sys; '
                'from privatespace_sync.single_instance import SingleInstance; '
                'instance=SingleInstance(Path(sys.argv[1])); print(instance.primary); instance.close()')
        return subprocess.run([sys.executable, '-c', code, str(state)], check=True, capture_output=True, text=True).stdout.strip()

    def test_second_process_signals_owner_and_lock_is_released_on_exit(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / 'state'
            instance = SingleInstance(state)
            try:
                self.assertTrue(instance.primary)
                self.assertEqual(self.launch(state), 'False')
                self.assertTrue(instance.activated())
                self.assertFalse(instance.activated())
                self.assertEqual(self.launch(state.with_name('other')), 'True')
                self.assertFalse(instance.activated())
            finally:
                instance.close()
            self.assertEqual(self.launch(state), 'True')

    def test_actual_tk_window_is_restored_on_second_launch(self):
        import tkinter as tk
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / 'state'
            instance = SingleInstance(state)
            window = tk.Tk(); window.geometry('400x240+10000+10000')
            try:
                window.withdraw(); window.update()
                bind_activation(window, instance)
                self.assertEqual(self.launch(state), 'False')
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline and window.state() == 'withdrawn':
                    window.update(); time.sleep(.02)
                self.assertEqual(window.state(), 'normal')
            finally:
                window.destroy(); instance.close()
