"""Windows file lock shared by CLI and desktop writers for one persistent state directory."""

from pathlib import Path
import msvcrt

from .transport import SyncError


class StateLock:
    def __init__(self, state: Path):
        path = state.absolute().with_name('.' + state.name + '.lock')
        path.parent.mkdir(parents=True, exist_ok=True)
        self.file = path.open('a+b')
        try:
            if path.stat().st_size == 0:
                self.file.write(b'\0')
                self.file.flush()
            self.file.seek(0)
            msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            self.file.close()
            raise SyncError('STATE_IN_USE') from None

    def close(self):
        if not self.file.closed:
            self.file.seek(0)
            try:
                msvcrt.locking(self.file.fileno(), msvcrt.LK_UNLCK, 1)
            finally:
                self.file.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
