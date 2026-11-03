"""Windowed executable entry; supports an isolated --state directory without console secrets."""

import os
from pathlib import Path
import argparse
import sys

from privatespace_sync.desktop import run


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--install', action='store_true')
    parser.add_argument('--state', type=Path, default=Path(os.environ.get('LOCALAPPDATA', str(Path.home() / 'AppData' / 'Local'))) / 'PrivateSpace' / 'Sync')
    args = parser.parse_args()
    if args.install or Path(sys.executable).name == '安装同步助手.exe':
        from privatespace_sync.installer import show_installer
        show_installer(Path(sys.executable).parent)
    else:
        run(args.state)
