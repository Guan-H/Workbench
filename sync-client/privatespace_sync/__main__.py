"""M0 Windows prototype commands; no tray UI or automatic startup is installed."""

from __future__ import annotations

import argparse
import getpass
import json
from pathlib import Path
import sys

from privatespace_sync import __version__
from privatespace_sync.engine import Engine, configure
from privatespace_sync.transport import SyncError
from privatespace_sync.watcher import DirectoryWatcher


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="privatespace-sync")
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )
    commands = parser.add_subparsers(dest="command")
    pair = commands.add_parser("pair", help="Pair an empty test directory with a five-minute single-use code")
    pair.add_argument("--url", required=True)
    pair.add_argument("--root", type=Path, required=True)
    pair.add_argument("--state", type=Path, required=True)
    for name in ("once", "watch", "status"):
        command = commands.add_parser(name)
        command.add_argument("--state", type=Path, required=True)
        if name == "once":
            command.add_argument("--confirm-deletions", help="Fingerprint from a concrete deletion preview")
    return parser


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = build_parser()
    args = parser.parse_args()
    if not args.command:
        parser.print_help(); return 0
    engine = None
    watcher = None
    try:
        if args.command == "pair":
            print(json.dumps(configure(args.url, args.root, args.state, getpass.getpass("Pairing code: ")), ensure_ascii=False))
            return 0
        engine = Engine(args.state)
        if args.command == "status":
            print(json.dumps(engine.status(), ensure_ascii=False)); return 0
        if args.command == "once":
            result = engine.cycle(confirmation=args.confirm_deletions)
            print(json.dumps(result, ensure_ascii=False))
            return 0 if result["status"] == "OK" else 2
        engine.fs.ready()
        watcher = DirectoryWatcher(engine.fs.root)
        retry = 0
        while True:
            result = engine.cycle()
            print(json.dumps(result, ensure_ascii=False), flush=True)
            offline = result.get("code") == "NETWORK_UNAVAILABLE"
            if result["status"] != "OK" and not offline or watcher.error:
                return 2
            # Real notifications plus periodic rescans; no timestamp decides a conflict winner.
            retry = min(retry + 1, 5) if offline else 0
            watcher.event.wait(timeout=(5, 15, 30, 60, 300)[retry - 1] if offline else 300)
            watcher.event.clear()
    except KeyboardInterrupt:
        return 0
    except (SyncError, OSError, ValueError) as error:
        print(json.dumps({"status": "PAUSED", "code": error.code if isinstance(error, SyncError) else "LOCAL_CONFIGURATION_UNAVAILABLE"}), file=sys.stderr)
        return 2
    finally:
        if watcher:
            watcher.close()
        if engine:
            engine.close()


if __name__ == "__main__":
    raise SystemExit(main())
