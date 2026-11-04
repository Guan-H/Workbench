"""Read-only initial merge review. Approval is per attempt; partial attempts never infer deletion."""

import json
import time
from .filesystem import digest, valid_path, excluded
from .transport import SyncError


class InitialMerge:
    def __init__(self, engine):
        self.engine = engine
        self.db = engine.db

    def pending(self):
        if self.db.execute("SELECT 1 FROM setting WHERE key = 'reconciliation_active'").fetchone():
            return True
        return bool(self.engine.config.get('initialMergeReview')) and not self.db.execute(
            "SELECT 1 FROM setting WHERE key = 'initial_merge_complete'").fetchone()

    def preview(self, checkpoint):
        engine = self.engine
        remote = engine.snapshot(checkpoint)
        first_directories, first_excluded = set(), []
        first, first_issues = engine.fs.scan(include=engine.selection.includes, descend=engine.selection.descends,
            directories=first_directories, exclusions=first_excluded)
        time.sleep(engine.stable_seconds)
        checkpoint()
        directories, exclusions = set(), []
        local, issues = engine.fs.scan(include=engine.selection.includes, descend=engine.selection.descends,
            directories=directories, exclusions=exclusions)
        first_excluded.sort(key=lambda item: (item['path'], item['code']))
        exclusions.sort(key=lambda item: (item['path'], item['code']))
        issues.extend(first_issues)
        for path in first.keys() | local.keys():
            if first.get(path) != local.get(path):
                issues.append({'path': path, 'code': 'FILE_BUSY'})
        if directories != first_directories or exclusions != first_excluded:
            issues.append({'path': '', 'code': 'FILE_BUSY'})
        by_path = {file['path'].casefold(): file for file in remote.values()}
        exclusions.extend({'path': file['path'], 'code': 'EXCLUDED_REMOTE'} for file in remote.values() if excluded(file['path']))
        for path in local:
            file = by_path.get(path.casefold())
            if file and file['path'] != path:
                issues += [{'path': value, 'code': 'INITIAL_PATH_CASE_CONFLICT'} for value in (path, file['path'])]
        required_dirs = set(engine.remote_folders)
        protected = set()
        for base in engine.baseline().values():
            if not base['deleted'] and engine.selection.includes(base['path']):
                parts = base['path'].split('/')
                protected.update('/'.join(parts[:index]) for index in range(1, len(parts)))
        for path in engine.remote_folders:
            parts = path.split('/')
            required_dirs.update('/'.join(parts[:index]) for index in range(1, len(parts)))
        local_dirs = {path.casefold(): path for path in directories}
        for file in remote.values():
            if file['deleted'] or excluded(file['path']):
                continue
            parts = file['path'].split('/')
            required_dirs.update('/'.join(parts[:index]) for index in range(1, len(parts)))
            try:
                target = engine.fs.path(file['path'])
                if target.is_dir():
                    issues.append({'path': file['path'], 'code': 'DIRECTORY_PATH_CONFLICT'})
            except SyncError as error:
                issues.append({'path': file['path'], 'code': error.code})
        for path in sorted(required_dirs):
            if not valid_path(path) or excluded(path):
                issues.append({'path': path, 'code': 'INVALID_PATH'})
                continue
            try:
                target = engine.fs.path(path)
                if target.exists() and not target.is_dir():
                    issues.append({'path': path, 'code': 'DIRECTORY_PATH_CONFLICT'})
                if not target.exists() and path in protected:
                    issues.append({'path': path, 'code': 'PARENT_DIRECTORY_UNAVAILABLE'})
                actual = local_dirs.get(path.casefold())
                if actual is not None and actual != path:
                    issues += [{'path': value, 'code': 'INITIAL_PATH_CASE_CONFLICT'} for value in (path, actual)]
            except SyncError as error:
                issues.append({'path': path, 'code': error.code})
        issues = sorted([dict(item) for item in {tuple(sorted(item.items())) for item in issues}], key=lambda item: (item['path'], item['code']))
        def unsafe(path):
            return any(not item['path'] or path == item['path'] or path.startswith(item['path'] + '/') for item in issues)
        changes = []
        conflicts = {row['path'] for row in self.db.execute('SELECT path FROM conflict')}
        for path in sorted(local.keys() | {file['path'] for file in remote.values()}):
            checkpoint()
            if unsafe(path) or excluded(path):
                continue
            file = by_path.get(path.casefold())
            sha = local.get(path)
            if path in conflicts:
                action = 'existing-conflict'
            elif file and file['deleted']:
                action = 'deleted-conflict' if sha else 'keep-tombstone'
            elif file and sha:
                action = 'same' if file['sha256'] == sha else 'conflict'
            else:
                action = 'upload' if sha else 'download'
            changes.append({'path': path, 'action': action, 'localSha256': sha,
                'remoteVersion': file['version'] if file else None, 'remoteSha256': file['sha256'] if file else None})
        for path in sorted(directories | required_dirs):
            if not unsafe(path):
                changes.append({'path': path, 'action': 'keep-directory' if path in directories else 'create-directory'})
        changes.extend({'path': item['path'], 'action': 'skip', 'code': item['code']} for item in issues + exclusions)
        queue = []
        for row in self.db.execute('SELECT * FROM queue ORDER BY path'):
            request = json.loads(row['request'])
            queue.append({key: request[key] for key in ('id', 'path', 'baseVersion', 'sha256', 'deleted')})
            changes.append({'path': row['path'], 'action': 'queued', 'localSha256': request['sha256']})
        summary = {}
        for change in changes:
            summary[change['action']] = summary.get(change['action'], 0) + 1
        signature = {'device': engine.config['device'], 'root': engine.config['identity'], 'scope': engine.selection.data(),
            'scopeVersion': engine.remote.scope_version, 'attachments': sorted(engine.selection.attachments), 'local': local,
            'directories': sorted(directories), 'issues': issues, 'exclusions': exclusions, 'queue': queue,
            'remote': [{key: file[key] for key in ('id', 'path', 'version', 'deleted', 'sha256')} for file in sorted(remote.values(), key=lambda file: file['id'])],
            'remoteDirectories': sorted(engine.remote_folders)}
        fingerprint = digest(json.dumps(signature, sort_keys=True, ensure_ascii=False).encode('utf-8'))
        self.expected_files = {identity: self.file_state(file) for identity, file in remote.items()}
        self.expected_purged = {identity for identity, file in remote.items() if file.get('_purged')}
        self.expected_directories = set(engine.remote_folders)
        self.expected_scope = self.scope_state()
        self.skipped = [item['path'] for item in issues]
        return {'fingerprint': fingerprint, 'changes': changes, 'summary': summary, 'issues': issues,
            'canApply': not any(item['code'] == 'FILE_BUSY' for item in issues),
            'requiresConfirmation': bool(local or directories or exclusions or issues or queue)}, local

    @staticmethod
    def file_state(file):
        return {key: file[key] for key in ('id', 'path', 'version', 'deleted', 'sha256')}

    def scope_state(self):
        return (self.engine.selection.data(), self.engine.remote.scope_version, sorted(self.engine.selection.attachments))

    def validate_remote(self, remote):
        # Acknowledging a known purged tombstone lets RemoteCatalog retire it locally.
        # This is our own cache cleanup, not a concurrent change to the approved merge.
        for identity in self.expected_purged - remote.keys():
            expected = self.expected_files[identity]
            row = self.db.execute('SELECT metadata FROM baseline WHERE path = ?', (expected['path'],)).fetchone()
            base = json.loads(row[0]) if row else None
            queued = self.db.execute('SELECT 1 FROM queue WHERE path = ?', (expected['path'],)).fetchone()
            if expected['deleted'] and base and base['id'] == identity and base['deleted'] and int(base['version']) >= int(expected['version']) and not queued:
                del self.expected_files[identity]
                self.expected_purged.remove(identity)
        if (self.scope_state() != self.expected_scope or self.engine.remote_folders != self.expected_directories
                or {identity: self.file_state(file) for identity, file in remote.items()} != self.expected_files):
            raise SyncError('INITIAL_MERGE_CHANGED')

    def published(self, file):
        self.expected_files[file['id']] = self.file_state(file)
        parts = file['path'].split('/')
        self.expected_directories.update('/'.join(parts[:index]) for index in range(1, len(parts))
            if self.engine.selection.directory('/'.join(parts[:index])))

    def begin(self, fingerprint):
        self.db.execute("INSERT OR REPLACE INTO setting VALUES ('initial_merge_attempt', ?)", (fingerprint,))
        self.db.commit()

    def finish(self):
        local, _ = self.engine.fs.scan(include=self.engine.selection.includes, descend=self.engine.selection.descends)
        conflicts = set()
        for row in self.db.execute('SELECT * FROM conflict'):
            conflicts.add(row['path']); conflicts.update(json.loads(row['copies']))
        baseline = self.engine.baseline()
        for path, sha in local.items():
            if path in conflicts or any(path == bad or path.startswith(bad + '/') for bad in self.skipped):
                continue
            base = baseline.get(path)
            if base is None or base['deleted'] or base['sha256'] != sha:
                raise SyncError('INITIAL_MERGE_CHANGED')
        self.db.execute("INSERT OR REPLACE INTO setting VALUES ('initial_merge_complete', 'true')")
        self.db.execute("DELETE FROM setting WHERE key = 'initial_merge_attempt'")
        self.db.execute("DELETE FROM setting WHERE key = 'reconciliation_active'")
        self.db.commit()
