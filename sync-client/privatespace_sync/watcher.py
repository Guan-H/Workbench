"""Windows directory notifications wake a full reconciliation; scans remain authoritative."""

from __future__ import annotations

import ctypes
from ctypes import wintypes
from pathlib import Path
import threading


class DirectoryWatcher:
    def __init__(self, root: Path):
        self.event = threading.Event()
        self.stopping = False
        self.error = None
        self.notifications = 0
        self.kernel = ctypes.WinDLL("Kernel32", use_last_error=True)
        self.kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
                                          wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        self.kernel.CreateFileW.restype = wintypes.HANDLE
        self.kernel.ReadDirectoryChangesW.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
                                                     wintypes.BOOL, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD),
                                                     ctypes.c_void_p, ctypes.c_void_p]
        self.kernel.ReadDirectoryChangesW.restype = wintypes.BOOL
        self.kernel.CancelIoEx.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.handle = self.kernel.CreateFileW(str(root), 1, 7, None, 3, 0x02000000, None)
        if self.handle == ctypes.c_void_p(-1).value:
            raise OSError(ctypes.get_last_error(), "Directory watcher could not open root")
        self.thread = threading.Thread(target=self._listen, daemon=True, name="private-space-directory-watch")
        self.thread.start()

    def _listen(self):
        buffer = ctypes.create_string_buffer(65536)
        length = wintypes.DWORD()
        while not self.stopping:
            if not self.kernel.ReadDirectoryChangesW(self.handle, buffer, len(buffer), True, 0x1 | 0x2 | 0x8 | 0x10, ctypes.byref(length), None, None):
                if not self.stopping:
                    self.error = ctypes.get_last_error()
                    self.event.set()
                return
            self.notifications += 1
            self.event.set()

    def close(self):
        self.stopping = True
        self.kernel.CancelIoEx(self.handle, None)
        self.thread.join(timeout=3)
        self.kernel.CloseHandle(self.handle)
