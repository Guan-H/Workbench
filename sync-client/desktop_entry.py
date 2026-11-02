"""Windowed executable entry; supports an isolated --state directory without console secrets."""

import os
from pathlib import Path
import argparse

from privatespace_sync.desktop import run


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--state', type=Path, default=Path(os.environ.get('LOCALAPPDATA', str(Path.home() / 'AppData' / 'Local'))) / 'PrivateSpace' / 'Sync')
    run(parser.parse_args().state)
