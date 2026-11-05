"""Conservative file-ID reconciliation and durable, conditional rename operations."""

import base64
from collections import Counter
import json
import uuid

from .filesystem import digest
from .transport import SyncError


class Renames:
    def __init__(self, engine):
        self.engine = engine
        self.db = engine.db
        self.fs = engine.fs

    def relocate_baseline(self, source, file, identity):
        self.db.execute('DELETE FROM baseline WHERE path = ?', (source,))
        self.db.execute('DELETE FROM local_identity WHERE path = ?', (source,))
        self.db.execute('DELETE FROM missing WHERE path IN (?, ?)', (source, file['path']))
        self.db.execute('INSERT OR REPLACE INTO baseline VALUES (?, ?)', (file['path'], json.dumps(file)))
        if identity:
            self.db.execute('INSERT OR REPLACE INTO local_identity VALUES (?, ?)', (file['path'], identity))

    def receive(self, remote, local, identities, skip, confirmation, checkpoint):
        """Persist intent before touching a local name, so a crash can finish the same move."""
        changed, issues, blocked = False, [], set()
        baseline = self.engine.baseline()
        known = dict(self.db.execute('SELECT path, identity FROM local_identity'))
        for file in remote.values():
            old = next((base for base in baseline.values() if base['id'] == file['id'] and not base['deleted']), None)
            if not old or old['path'] == file['path'] or file['deleted']:
                continue
            source, target = old['path'], file['path']
            blocked.update((source, target))
            if skip(source) or skip(target):
                continue
            if not self.engine.selection.explicit(source) or not self.engine.selection.explicit(target):
                issues.append({'path': target, 'code': 'RENAME_OUTSIDE_EXPLICIT_SCOPE'}); continue
            identity = known.get(source)
            if not identity:
                issues.append({'path': target, 'code': 'RENAME_IDENTITY_UNAVAILABLE'}); continue
            entry = {'source': source, 'base': old, 'target': target, 'identity': identity,
                     'remoteVersion': file['version'], 'attempted': False}
            self.db.execute('INSERT OR IGNORE INTO local_rename VALUES (?, ?)', (file['id'], json.dumps(entry)))
            self.db.commit()
        entries = []
        for row in list(self.db.execute('SELECT * FROM local_rename ORDER BY id')):
            entry = json.loads(row['intent'])
            # A held move owns both names; neither may fall through to upload/delete.
            blocked.update((entry['source'], entry['target']))
            latest = remote.get(row['id'])
            if not latest or latest['deleted']:
                issues.append({'path': entry['target'], 'code': 'RENAME_REQUIRES_RECONCILIATION'}); continue
            if not entry['attempted']:
                if latest['path'] == entry['source']:
                    self.db.execute('DELETE FROM local_rename WHERE id = ?', (row['id'],)); continue
                entry.update(target=latest['path'], remoteVersion=latest['version'])
                self.db.execute('UPDATE local_rename SET intent = ? WHERE id = ?', (json.dumps(entry), row['id']))
            if (not skip(entry['source']) and not skip(entry['target']) and self.engine.selection.explicit(entry['source'])
                    and self.engine.selection.explicit(entry['target'])):
                entries.append((row['id'], entry))
        self.db.commit()
        changes = [{'direction': 'rename-local', 'source': entry['source'], 'path': entry['target'],
                    'id': identity, 'version': entry['remoteVersion'], 'sha': entry['base']['sha256']} for identity, entry in entries]
        reviewing = self.db.execute("SELECT value FROM setting WHERE key = 'local_rename_review'").fetchone()
        count = max(1, sum(not file['deleted'] and self.engine.selection.includes(file['path']) for file in baseline.values()))
        fingerprint = digest(json.dumps(changes, sort_keys=True).encode())
        if changes and (reviewing or len(changes) > 20 or len(changes) / count > .1) and confirmation != fingerprint:
            self.db.execute("INSERT OR REPLACE INTO setting VALUES ('local_rename_review', ?)", (fingerprint,)); self.db.commit()
            return changed, issues, blocked, {'status': 'REQUIRES_CONFIRMATION', 'code': None,
                                            'deletionPreview': {'fingerprint': fingerprint, 'changes': changes}}
        for identity_key, entry in entries:
            checkpoint()
            source, target, identity = entry['source'], entry['target'], entry['identity']
            blocked.update((source, target))
            if skip(source) or skip(target) or not self.engine.selection.explicit(source) or not self.engine.selection.explicit(target):
                continue
            try:
                data, at_target = self.fs.read_state(target)
                # A committed filesystem move is recognized by identity, never by equal contents.
                if target not in local or at_target != identity:
                    data, at_source = self.fs.read_state(source)
                    if at_source != identity or data is None or digest(data) != entry['base']['sha256']:
                        raise SyncError('RENAME_MODIFY_CONFLICT')
                    entry['attempted'] = True
                    self.db.execute('UPDATE local_rename SET intent = ? WHERE id = ?', (json.dumps(entry), identity_key)); self.db.commit()
                    self.fs.rename(source, target, identity, entry['base']['sha256'])
                relocated = {**entry['base'], 'path': target}
                self.relocate_baseline(source, relocated, identity)
                self.db.execute('DELETE FROM local_rename WHERE id = ?', (identity_key,))
                self.db.commit()
                changed = True
                blocked.difference_update((source, target))
            except (SyncError, OSError) as error:
                issues.append({'path': target, 'code': error.code if isinstance(error, SyncError) else 'LOCAL_IO_UNAVAILABLE'})
        if not issues:
            self.db.execute("DELETE FROM setting WHERE key = 'local_rename_review'"); self.db.commit()
        return changed, issues, blocked, None

    def send(self, local, identities, skip, confirmation, checkpoint):
        baseline = self.engine.baseline()
        known = dict(self.db.execute('SELECT path, identity FROM local_identity'))
        unique_local = Counter(identities.values())
        unique_base = Counter(known.values())
        pending = {row['source']: dict(row) for row in self.db.execute('SELECT * FROM rename_queue')}
        for source, row in list(pending.items()):
            if not self.engine.selection.explicit(source) or not self.engine.selection.explicit(row['target']):
                continue
            if row['attempted']:
                continue
            paths = [path for path, key in identities.items() if key == row['identity']]
            if paths == [source]:
                self.db.execute('DELETE FROM rename_queue WHERE source = ?', (source,))
                del pending[source]
            elif len(paths) != 1 or skip(paths[0]):
                raise SyncError('LOCAL_CHANGED_BEFORE_RENAME')
            else:
                target = paths[0]
                request = json.loads(row['request'])
                if target != row['target'] or local[target] != request['sha256']:
                    data, identity = self.fs.read_state(target)
                    if identity != row['identity'] or data is None or digest(data) != local[target]:
                        raise SyncError('LOCAL_CHANGED_BEFORE_RENAME')
                    request.update(targetPath=target, sha256=local[target], contentBase64=base64.b64encode(data).decode('ascii'))
                    row.update(target=target, operation=str(uuid.uuid4()), request=json.dumps(request))
                    self.db.execute('UPDATE rename_queue SET target = ?, operation = ?, request = ? WHERE source = ?',
                                    (row['target'], row['operation'], row['request'], source))
        self.db.commit()
        for target, identity in identities.items():
            if unique_local[identity] != 1 or unique_base[identity] != 1:
                continue
            source = next((path for path, key in known.items() if key == identity), None)
            base = baseline.get(source)
            if not base or base['deleted'] or source == target or identities.get(source) == identity:
                continue
            if skip(source) or skip(target):
                raise SyncError('LOCAL_CHANGED_BEFORE_RENAME')
            if not self.engine.selection.explicit(source) or not self.engine.selection.explicit(target):
                continue
            if source in pending or self.db.execute('SELECT 1 FROM queue WHERE path IN (?, ?)', (source, target)).fetchone():
                continue
            data, current = self.fs.read_state(target)
            if current != identity or data is None or digest(data) != local[target]:
                raise SyncError('LOCAL_CHANGED_BEFORE_RENAME')
            request = {'id': base['id'], 'sourcePath': source, 'targetPath': target, 'baseVersion': base['version'],
                       'sha256': local[target], 'contentBase64': base64.b64encode(data).decode('ascii') if local[target] != base['sha256'] else None}
            pending[source] = {'source': source, 'target': target, 'operation': str(uuid.uuid4()),
                               'request': json.dumps(request), 'identity': identity, 'attempted': 0}
        scoped = [row for row in pending.values() if self.engine.selection.explicit(row['source']) and self.engine.selection.explicit(row['target'])]
        active = [row for row in scoped if not skip(row['source']) and not skip(row['target'])]
        blocked = {path for row in scoped for path in (row['source'], row['target'])}
        if not active:
            if not pending:
                self.db.execute("DELETE FROM setting WHERE key = 'rename_review'")
            self.db.commit()
            return None, blocked
        if not self.engine.rename_supported:
            raise SyncError('RENAME_SERVER_UPGRADE_REQUIRED')
        changes = [{'direction': 'rename-remote', 'source': row['source'], 'path': row['target'],
                    'id': json.loads(row['request'])['id'], 'version': json.loads(row['request'])['baseVersion'],
                    'sha': json.loads(row['request'])['sha256']} for row in sorted(active, key=lambda row: row['source'])]
        fingerprint = digest(json.dumps(changes, sort_keys=True).encode())
        reviewing = self.db.execute("SELECT value FROM setting WHERE key = 'rename_review'").fetchone()
        # Pending payloads and operation IDs are durable even before confirmation and while offline.
        for row in pending.values():
            self.db.execute('INSERT OR IGNORE INTO rename_queue (source, target, operation, request, identity) VALUES (?, ?, ?, ?, ?)',
                            (row['source'], row['target'], row['operation'], row['request'], row['identity']))
        self.db.commit()
        count = max(1, sum(not file['deleted'] and self.engine.selection.includes(file['path']) for file in baseline.values()))
        review = reviewing or len(active) > 20 or len(active) / count > .1
        if review and confirmation != fingerprint:
            self.db.execute("INSERT OR REPLACE INTO setting VALUES ('rename_review', ?)", (fingerprint,)); self.db.commit()
            return {'status': 'REQUIRES_CONFIRMATION', 'code': None, 'deletionPreview': {'fingerprint': fingerprint, 'changes': changes}}, blocked
        issues = []
        for row in active:
            checkpoint()
            try:
                self.db.execute('UPDATE rename_queue SET attempted = 1 WHERE source = ?', (row['source'],)); self.db.commit()
                result = self.engine.remote.request('/file-renames', body=json.loads(row['request']), operation=row['operation'])
                self.relocate_baseline(row['source'], result, row['identity'])
                self.db.execute('DELETE FROM rename_queue WHERE source = ?', (row['source'],))
                self.db.commit()
            except SyncError as error:
                if not error.status or error.status in (401, 403) or error.code == 'SYNC_SCOPE_CHANGED':
                    raise
                issues.append({'path': row['target'], 'code': error.code})
        if issues:
            return {'status': 'PAUSED', 'code': 'RENAME_REQUIRES_RECONCILIATION', 'issues': issues}, blocked
        self.db.execute("DELETE FROM setting WHERE key = 'rename_review'"); self.db.commit()
        return None, set()
