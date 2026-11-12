"""Publish only the built Windows bundle, never local sync state or credentials."""

import argparse
import hashlib
import json
from pathlib import Path
import stat
import struct
import subprocess
import tempfile
import tomllib
import zipfile
from datetime import datetime, timezone


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    bundle = args.bundle.resolve()
    if not bundle.is_relative_to((root / 'sync-client/dist').resolve()):
        raise ValueError('Bundle must be inside sync-client/dist.')
    executable = bundle / 'privatespace-sync.exe'
    required = [executable, bundle / '安装同步助手.exe', bundle / '安装说明.txt']
    if not all(path.is_file() for path in required) or not (bundle / '_internal').is_dir():
        raise ValueError('Build the complete desktop bundle first.')
    files = required + sorted(path for path in (bundle / '_internal').rglob('*') if path.is_file())
    for path in [bundle, bundle / '_internal', *files, *list((bundle / '_internal').rglob('*'))]:
        if path.is_symlink() or path.stat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ValueError('Bundle must not contain links or reparse points.')
    with executable.open('rb') as stream:
        stream.seek(0x3c)
        pe_offset = struct.unpack('<I', stream.read(4))[0]
        stream.seek(pe_offset)
        if stream.read(4) != b'PE\0\0' or struct.unpack('<H', stream.read(2))[0] != 0x8664:
            raise ValueError('Expected a Windows x64 executable.')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True).strip())
    version = tomllib.loads((root / 'sync-client/pyproject.toml').read_text(encoding='utf-8'))['project']['version']
    metadata = {'version': version, 'builtAt': datetime.now(timezone.utc).isoformat(),
                'platform': 'windows-x64', 'sourceRevision': revision, 'sourceDirty': dirty}
    target = root / 'frontend/public/downloads'
    target.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=root / 'sync-client/dist') as temporary:
        archive = Path(temporary) / 'assistant.zip'
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
            for path in files:
                output.write(path, 'privatespace-sync/' + path.relative_to(bundle).as_posix())
            output.writestr('privatespace-sync/release.json', json.dumps(metadata, ensure_ascii=False, indent=2))
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        name = 'privatespace-sync-windows-x64-' + digest[:12] + '.zip'
        archive.replace(target / name)
    metadata.update({'file': name, 'bytes': (target / name).stat().st_size, 'sha256': digest})
    manifest = target / 'sync-assistant.json'
    staging = target / 'sync-assistant.json.tmp'
    staging.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    staging.replace(manifest)
    print(json.dumps({'file': name, 'bytes': metadata['bytes'], 'sha256': digest}))


if __name__ == '__main__':
    main()
