"""Retain independent pairings; switching never reuses another server's credentials or queue."""

import json
import os
from pathlib import Path
import tempfile
import uuid

from .state_lock import StateLock
from .transport import SyncError


class Profiles:
    def __init__(self, legacy: Path):
        self.legacy = legacy.absolute()
        self.directory = self.legacy.with_name(self.legacy.name + '.profiles')
        self._safe(self.legacy)
        self._safe(self.directory)
        self.lock = StateLock(self.directory)
        try:
            registry = self.directory / 'registry.json'
            self._safe(registry)
            self.data = json.loads(registry.read_text(encoding='utf-8')) if registry.exists() else {
                'active': 'default', 'profiles': [{'id': 'default', 'name': '默认配置'}]}
            entries = self.data['profiles']
            ids = [entry['id'] for entry in entries]
            if (not entries or len(set(ids)) != len(ids) or 'default' not in ids or self.data['active'] not in ids
                    or any(not isinstance(entry['name'], str) or not 1 <= len(entry['name']) <= 80 for entry in entries)):
                raise ValueError('Invalid profile registry')
            for identity in ids:
                self.path(identity)
        except Exception:
            self.lock.close()
            raise

    @staticmethod
    def _safe(path):
        if any(part.is_symlink() or part.is_junction() for part in (path, *path.parents)):
            raise SyncError('UNSAFE_LINK')

    @property
    def active(self):
        return self.data['active']

    def path(self, identity):
        if identity == 'default':
            target = self.legacy
        else:
            if str(uuid.UUID(identity)) != identity:
                raise ValueError('Invalid profile identity')
            target = self.directory / identity
        self._safe(target)
        return target

    def entries(self):
        result = []
        for item in self.data['profiles']:
            try:
                config_path = self.path(item['id']) / 'config.json'
                self._safe(config_path)
                config = json.loads(config_path.read_text(encoding='utf-8')) if config_path.exists() else {}
                if not isinstance(config, dict) or any(key in config and not isinstance(config[key], str) for key in ('url', 'root')):
                    raise ValueError('Invalid profile configuration')
                result.append({**item, 'url': config.get('url'), 'root': config.get('root'), 'error': False})
            except (OSError, ValueError, SyncError):
                result.append({**item, 'url': None, 'root': None, 'error': True})
        return result

    def _save(self, data):
        self._safe(self.directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix='.registry-', dir=self.directory)
        try:
            with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
                json.dump(data, output, ensure_ascii=False)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, self.directory / 'registry.json')
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        self.data = data

    def create(self, name):
        name = name.strip()
        if not 1 <= len(name) <= 80:
            raise SyncError('INVALID_PROFILE_NAME')
        identity = str(uuid.uuid4())
        self._save({'active': identity, 'profiles': [*self.data['profiles'], {'id': identity, 'name': name}]})
        return identity

    def activate(self, identity):
        if identity not in [entry['id'] for entry in self.data['profiles']]:
            raise SyncError('PROFILE_NOT_FOUND')
        self._save({**self.data, 'active': identity})

    def validate_root(self, root):
        self._safe(root.absolute())
        target = root.resolve()
        protected = [self.legacy.resolve(), self.directory.resolve()]
        protected += [Path(item['root']).resolve() for item in self.entries() if item['root']]
        if any(target == path or target.is_relative_to(path) or path.is_relative_to(target) for path in protected):
            raise SyncError('PROFILE_ROOT_OVERLAP')

    def close(self):
        self.lock.close()
