"""Version-checked conflict choices with durable, idempotent resolution jobs."""

import base64
import json
import uuid

from .filesystem import digest
from .transport import SyncError


def state(file):
    return {key: file[key] for key in ('id', 'path', 'version', 'deleted', 'sha256')} if file else None


def preview(engine, path):
    from . import rename_conflicts
    if rename_conflicts.find(engine, path):
        return rename_conflicts.preview(engine, path)
    row = engine.db.execute('SELECT * FROM conflict WHERE path=?', (path,)).fetchone()
    if not row:
        raise SyncError('CONFLICT_NOT_FOUND')
    remote = engine.snapshot()
    if not engine.selection.includes(path):
        raise SyncError('OUTSIDE_SYNC_SCOPE')
    if path in engine.remote_folders:
        raise SyncError('DIRECTORY_PATH_CONFLICT')
    file = next((file for file in remote.values() if file['path'].casefold() == path.casefold()), None)
    if file and file['path'] != path:
        raise SyncError('INITIAL_PATH_CASE_CONFLICT')
    if any(path in (row['source'], row['target']) for row in engine.db.execute('SELECT source,target FROM rename_queue')):
        raise SyncError('RENAME_REQUIRES_RECONCILIATION')
    variants = []
    def add(identity, label, data):
        variants.append({'id': identity, 'label': label, 'data': base64.b64encode(data).decode('ascii') if data is not None else None,
            'sha256': digest(data) if data is not None else None, 'size': len(data) if data is not None else 0})
    add('server', '服务器当前版本' if file and not file['deleted'] else '服务器已删除或不存在（采用将回收本地文件）',
        engine.download(file) if file and not file['deleted'] else None)
    local = engine.fs.read(path)
    if local is not None:
        add('local', '当前本地文件', local)
    for copy in json.loads(row['copies']):
        data = engine.fs.read(copy)
        if data is not None:
            add('copy:' + copy, '本地冲突副本：' + copy, data)
    for archived in engine.db.execute('SELECT id,payload FROM reconciliation_archive ORDER BY created,id'):
        for task in json.loads(archived['payload'])['state']['queue']:
            request = json.loads(task['request'])
            if task['path'] == path and not request['deleted']:
                add('archive:' + archived['id'] + ':' + task['operation'], '对账归档中的旧编辑',
                    base64.b64decode(request['contentBase64'], validate=True))
    pending = None
    for job in engine.db.execute('SELECT * FROM conflict_resolution WHERE path=? ORDER BY rowid', (path,)):
        plan = json.loads(job['payload'])
        if job['status'] == 'pending':
            pending = job['id']
        if plan['data'] is not None:
            add('job:' + job['id'], '上次处理保留的内容（' + job['status'] + '）', base64.b64decode(plan['data'], validate=True))
    queue = [dict(item) for item in engine.db.execute('SELECT * FROM queue WHERE path=?', (path,))]
    signature = {'path': path, 'conflict': dict(row), 'file': state(file), 'scope': engine.remote.scope_version,
        'variants': [{key: item[key] for key in ('id', 'sha256', 'size')} for item in variants], 'queue': queue,
        'pending': pending}
    return {'path': path, 'file': file, 'variants': variants, 'pending': pending,
        'fingerprint': digest(json.dumps(signature, sort_keys=True).encode()), 'localSha256': digest(local) if local is not None else None,
        'scopeVersion': engine.remote.scope_version, 'conflict': dict(row), 'queue': queue,
        'draft': next((item['content'] for item in engine.db.execute('SELECT content FROM conflict_draft WHERE path=?', (path,))), None)}


def save_draft(engine, path, content):
    from .rename_conflicts import find
    if not engine.db.execute('SELECT 1 FROM conflict WHERE path=?', (path,)).fetchone() and not find(engine, path):
        raise SyncError('CONFLICT_NOT_FOUND')
    if not path.lower().endswith('.md') or len(content.encode('utf-8')) > 1024 * 1024:
        raise SyncError('FILE_TOO_LARGE')
    # Drafts remain ordinary local note data, owned by the same SQLite writer as sync jobs.
    with engine.db:
        engine.db.execute('INSERT OR REPLACE INTO conflict_draft VALUES (?,?)', (path, content))


def resolve(engine, path, fingerprint, variant=None, merged=None, resume=None):
    if resume:
        row = engine.db.execute("SELECT * FROM conflict_resolution WHERE id=? AND path=? AND status='pending'", (resume, path)).fetchone()
        if not row:
            raise SyncError('CONFLICT_CHANGED')
        operation, plan = row['id'], json.loads(row['payload'])
    else:
        review = preview(engine, path)
        path = review['path']
        if review['fingerprint'] != fingerprint:
            raise SyncError('CONFLICT_CHANGED')
        if merged is not None:
            if not path.lower().endswith('.md'):
                raise SyncError('INVALID_REQUEST')
            data = merged.encode('utf-8')
        else:
            selected = next((item for item in review['variants'] if item['id'] == variant), None)
            if selected is None:
                raise SyncError('CONFLICT_CHANGED')
            data = base64.b64decode(selected['data'], validate=True) if selected['data'] is not None else None
        if data is not None and len(data) > (1024 * 1024 if path.lower().endswith('.md') else 50 * 1024 * 1024):
            raise SyncError('FILE_TOO_LARGE')
        if path.lower().endswith('.md') and data is not None:
            try:
                data.decode('utf-8')
            except UnicodeError:
                raise SyncError('INVALID_REQUEST') from None
        file = review['file']
        request = None if variant == 'server' and merged is None else {
            'id': file['id'] if file else None, 'path': path, 'baseVersion': file['version'] if file else '0',
            'deleted': False, 'sha256': digest(data), 'contentBase64': base64.b64encode(data).decode('ascii')}
        operation = str(uuid.uuid4())
        plan = {'data': base64.b64encode(data).decode('ascii') if data is not None else None, 'request': request,
            'remote': state(file), 'localSha256': review['localSha256'], 'scopeVersion': review['scopeVersion'],
            'oldQueue': review['queue'], 'conflict': review['conflict'],
            'choice': 'merged' if merged is not None else variant.partition(':')[0]}
        if review.get('rename'):
            plan['rename'] = review['rename']
        with engine.db:
            engine.db.execute("UPDATE conflict_resolution SET status='held' WHERE path=? AND status='pending'", (path,))
            engine.db.execute("INSERT INTO conflict_resolution VALUES (?,?,?,'pending')", (operation, path, json.dumps(plan)))
    try:
        return execute(engine, path, operation, plan)
    except SyncError as error:
        if error.code not in ('NETWORK_UNAVAILABLE', 'LOCAL_IO_UNAVAILABLE', 'PAUSE_REQUESTED') and error.status not in (401, 403):
            engine.db.execute("UPDATE conflict_resolution SET status='held' WHERE id=?", (operation,)); engine.db.commit()
        raise


def execute(engine, path, operation, plan):
    if plan.get('rename'):
        from .rename_conflicts import execute as execute_rename
        return execute_rename(engine, path, operation, plan)
    # A resolution can be resumed only for the same chosen payload and operation.
    # Never turn a 409 into an unconditional retry with a newer base version.
    engine.snapshot()
    if not engine.selection.includes(path) or engine.remote.scope_version != plan['scopeVersion']:
        raise SyncError('SYNC_SCOPE_CHANGED')
    local = engine.fs.read(path)
    data = base64.b64decode(plan['data'], validate=True) if plan['data'] is not None else None
    sha = digest(local) if local is not None else None
    chosen_sha = digest(data) if data is not None else None
    if sha not in (plan['localSha256'], chosen_sha):
        raise SyncError('CONFLICT_CHANGED')
    if plan['request']:
        engine.remote.scope_version = plan['scopeVersion']
        file = engine.remote.request('/conflict-files', body=plan['request'], operation=operation)
    else:
        file = None
    current = next((item for item in engine.snapshot().values() if item['path'] == path), None)
    if not engine.selection.includes(path) or engine.remote.scope_version != plan['scopeVersion']:
        raise SyncError('SYNC_SCOPE_CHANGED')
    if state(current) != (state(file) if file else plan['remote']):
        raise SyncError('CONFLICT_CHANGED')
    if local != data:
        if local is not None:
            engine.archive(path, local, current['version'] if current else '0')
        if data is None:
            if engine.fs.read(path) != local:
                raise SyncError('CONFLICT_CHANGED')
            engine.fs.path(path).unlink(missing_ok=True)
        else:
            engine.fs.atomic(path, data, sha)
    # A second edit during publication leaves the conflict and preserved job intact.
    latest = engine.fs.read(path)
    if (digest(latest) if latest is not None else None) != chosen_sha:
        raise SyncError('CONFLICT_CHANGED')
    if state(next((item for item in engine.snapshot().values() if item['path'] == path), None)) != state(current):
        raise SyncError('CONFLICT_CHANGED')
    with engine.db:
        if current:
            engine.db.execute('INSERT OR REPLACE INTO baseline VALUES (?,?)', (path, json.dumps(current)))
        else:
            engine.db.execute('DELETE FROM baseline WHERE path=?', (path,))
        engine.db.execute('DELETE FROM local_identity WHERE path=?', (path,))
        engine.db.execute('DELETE FROM missing WHERE path=?', (path,))
        engine.db.execute('DELETE FROM queue WHERE path=?', (path,))
        engine.db.execute('DELETE FROM conflict WHERE path=?', (path,))
        engine.db.execute('DELETE FROM conflict_draft WHERE path=?', (path,))
        engine.db.execute("UPDATE conflict_resolution SET status='done' WHERE id=?", (operation,))
    return {'status': 'CONFLICT_RESOLVED', **engine.status()}
