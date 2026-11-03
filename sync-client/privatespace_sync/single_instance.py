"""One GUI per state root; a repeated launch signals the existing window, without an HTTP port."""

import ctypes
from ctypes import wintypes
import hashlib
import os
from pathlib import Path
import time


class SingleInstance:
    def __init__(self, state: Path):
        key = hashlib.sha256(os.path.normcase(str(state.resolve())).encode('utf-8')).hexdigest()
        self.name = 'Local\\PrivateSpaceSyncGUI-' + key
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        for name, arguments, result in (
            ('CreateMutexW', [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR], wintypes.HANDLE),
            ('CreateEventW', [ctypes.c_void_p, wintypes.BOOL, wintypes.BOOL, wintypes.LPCWSTR], wintypes.HANDLE),
            ('OpenEventW', [wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR], wintypes.HANDLE),
            ('WaitForSingleObject', [wintypes.HANDLE, wintypes.DWORD], wintypes.DWORD),
            ('SetEvent', [wintypes.HANDLE], wintypes.BOOL),
            ('ReleaseMutex', [wintypes.HANDLE], wintypes.BOOL),
            ('CloseHandle', [wintypes.HANDLE], wintypes.BOOL),
        ):
            function = getattr(self.kernel, name)
            function.argtypes = arguments
            function.restype = result
        self.event = None
        ctypes.set_last_error(0)
        self.mutex = self.kernel.CreateMutexW(None, True, self.name)
        existed = ctypes.get_last_error() == 183
        if not self.mutex:
            raise ctypes.WinError(ctypes.get_last_error())
        self.primary = not existed
        try:
            if existed:
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    # An owner that exited/crashed between launches must not leave a stale lock.
                    if self.kernel.WaitForSingleObject(self.mutex, 0) in (0, 128):
                        self.primary = True
                        break
                    event = self.kernel.OpenEventW(0x0002, False, self.name + '-activate')
                    if event:
                        try:
                            user = ctypes.WinDLL('user32', use_last_error=True)
                            user.AllowSetForegroundWindow(wintypes.DWORD(0xffffffff))
                            if not self.kernel.SetEvent(event):
                                raise ctypes.WinError(ctypes.get_last_error())
                        finally:
                            self.kernel.CloseHandle(event)
                        return
                    time.sleep(.05)
                if not self.primary:
                    raise OSError('已有助手正在启动，请稍后重试。')
            self.event = self.kernel.CreateEventW(None, False, False, self.name + '-activate')
            if not self.event:
                raise ctypes.WinError(ctypes.get_last_error())
        except Exception:
            self.close()
            raise

    def activated(self):
        return bool(self.event and self.kernel.WaitForSingleObject(self.event, 0) == 0)

    def close(self):
        if self.event:
            self.kernel.CloseHandle(self.event)
            self.event = None
        if self.mutex:
            if self.primary:
                self.kernel.ReleaseMutex(self.mutex)
            self.kernel.CloseHandle(self.mutex)
            self.mutex = None


def bind_activation(window, instance):
    timer = None
    def poll():
        nonlocal timer
        if instance.activated():
            window.deiconify()
            window.lift()
            target = window.grab_current() or window
            target.lift()
            target.focus_force()
        timer = window.after(150, poll)
    def destroyed(event):
        if event.widget == window and timer:
            window.after_cancel(timer)
    window.bind('<Destroy>', destroyed, add='+')
    poll()
