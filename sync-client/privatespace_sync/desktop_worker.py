"""One background owner for Engine, SQLite and notifications; Tk only receives state events."""

from dataclasses import dataclass
import logging
from pathlib import Path
from queue import Empty, Queue
import sqlite3
import threading
import time

from .engine import Engine, configure
from .transport import SyncError
from .watcher import DirectoryWatcher


@dataclass(frozen=True)
class PairCommand:
    url: str
    root: Path
    code: str


@dataclass(frozen=True)
class RunCommand:
    automatic: bool = False
    confirmation: str | None = None


@dataclass(frozen=True)
class PauseCommand:
    pass


@dataclass(frozen=True)
class ExitCommand:
    pass


class SyncWorker:
    def __init__(self, state: Path):
        self.state = state
        self.commands: Queue[PairCommand | RunCommand | PauseCommand | ExitCommand] = Queue()
        self.events: Queue[dict] = Queue()
        self.pause_requested = threading.Event()
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self._run, name='private-space-sync-owner')
        self.engine: Engine | None = None
        self.watcher: DirectoryWatcher | None = None
        self.automatic = False
        self.last_result: dict = {}
        self.next_scan = 0.0
        self.retry = 0

    def start(self):
        self.thread.start()

    def pause(self):
        self.pause_requested.set()
        self.commands.put(PauseCommand())

    def run_cycle(self, *, automatic: bool = False, confirmation: str | None = None):
        self.pause_requested.clear()
        self.commands.put(RunCommand(automatic, confirmation))

    def close(self):
        self.pause_requested.set()
        self.commands.put(ExitCommand())

    def _publish(self, phase: str, code: str | None = None):
        self.events.put({'phase': phase, 'code': code, 'automatic': self.automatic,
                         'root': self.engine.config['root'] if self.engine else None,
                         'url': self.engine.config['url'] if self.engine else None,
                         'result': self.last_result})

    def _stop_watcher(self):
        self.automatic = False
        if self.watcher:
            self.watcher.close()
            self.watcher = None

    def _cycle(self, confirmation: str | None = None):
        if not self.engine:
            raise SyncError('PAIR_FIRST')
        if self.watcher:
            self.watcher.event.clear()
        self._publish('RUNNING')
        result = self.engine.cycle(confirmation=confirmation, should_pause=self.pause_requested.is_set)
        self.last_result = result
        code = result.get('code')
        if code == 'NETWORK_UNAVAILABLE' and self.automatic:
            self.retry = min(self.retry + 1, 5)
            self.next_scan = time.monotonic() + (5, 15, 30, 60, 300)[self.retry - 1]
            self._publish('OFFLINE', code)
        elif code == 'PAUSE_REQUESTED':
            self._stop_watcher()
            self._publish('PAUSED')
        elif result['status'] != 'OK' or result.get('issues') or result.get('conflicts') or result.get('queued'):
            self._stop_watcher()
            self._publish('ATTENTION', code)
        else:
            self.retry = 0
            self.next_scan = time.monotonic() + 300
            self._publish('WATCHING' if self.automatic else 'READY')

    def _run(self):
        try:
            try:
                if (self.state / 'config.json').is_file():
                    self.engine = Engine(self.state)
                    self.last_result = self.engine.status()
                self._publish('PAUSED' if self.engine else 'UNPAIRED')
            except (SyncError, OSError, ValueError, sqlite3.Error) as error:
                self._publish('ERROR', error.code if isinstance(error, SyncError) else 'LOCAL_CONFIGURATION_UNAVAILABLE')
            while True:
                try:
                    command = self.commands.get(timeout=.2)
                except Empty:
                    if self.automatic and not self.pause_requested.is_set():
                        if self.watcher and self.watcher.error:
                            self._stop_watcher()
                            self._publish('ERROR', 'DIRECTORY_WATCH_UNAVAILABLE')
                        elif time.monotonic() >= self.next_scan or self.retry == 0 and self.watcher and self.watcher.event.is_set():
                            self._cycle()
                    continue
                try:
                    if isinstance(command, ExitCommand):
                        break
                    if isinstance(command, PauseCommand):
                        self._stop_watcher()
                        self._publish('PAUSED' if self.engine else 'UNPAIRED')
                    elif isinstance(command, PairCommand):
                        if self.engine:
                            raise SyncError('ALREADY_PAIRED')
                        self._publish('PAIRING')
                        configure(command.url, command.root, self.state, command.code)
                        self.engine = Engine(self.state)
                        self.last_result = self.engine.status()
                        self._publish('PAUSED')
                    elif isinstance(command, RunCommand):
                        if not self.engine:
                            raise SyncError('PAIR_FIRST')
                        if command.automatic and not self.watcher:
                            self.engine.fs.ready()
                            self.watcher = DirectoryWatcher(self.engine.fs.root)
                            self.automatic = True
                        self._cycle(command.confirmation)
                except (SyncError, OSError, ValueError, sqlite3.Error) as error:
                    self._stop_watcher()
                    self._publish('ERROR', error.code if isinstance(error, SyncError) else 'LOCAL_IO_UNAVAILABLE')
                finally:
                    # Do not retain a consumed pairing code in the idle worker's last command.
                    command = None
        except Exception as error:
            logging.error('Sync worker stopped with %s', type(error).__name__)
            self._publish('ERROR', 'INTERNAL_ERROR')
        finally:
            try:
                self._stop_watcher()
                if self.engine:
                    self.engine.close()
            finally:
                self.stopped.set()
