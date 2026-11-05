"""Explicit choices for a remote rename and local edits, using durable resolution jobs."""

import base64
import json
from .filesystem import digest
from .transport import SyncError


def signature(file):
    return {key: file[key] for key in ('id', 'path', 'version', 'deleted', 'sha256')}


def find(engine, path):
    for row in engine.db.execute('SELECT * FROM local_rename'):
        intent = json.loads(row['intent'])
        if path in (intent['source'], intent['target']):
            return row['id'], intent
    return None


def sha(data):
    return digest(data) if data is not None else None


def preview(engine, path):
    catalog = engine.snapshot()
    found = find(engine, path)
    if not found:
        raise SyncError('CONFLICT_NOT_FOUND')
    identity, intent = found
    source, target = intent['source'], intent['target']
    file = catalog.get(identity)
    if not file or file['deleted'] or file['path'] != target:
        raise SyncError('CONFLICT_CHANGED')
    if not engine.selection.explicit(source) or not engine.selection.explicit(target):
        raise SyncError('OUTSIDE_SYNC_SCOPE')
    if engine.db.execute('SELECT 1 FROM rename_queue WHERE source IN (?,?) OR target IN (?,?)', (source, target, source, target)).fetchone():
        raise SyncError('RENAME_REQUIRES_RECONCILIATION')
    local, local_identity = engine.fs.read_state(source)
    destination = engine.fs.read(target)
    variants = []
    def add(key, label, data):
        variants.append({'id': key, 'label': label, 'data': base64.b64encode(data).decode('ascii'), 'sha256': digest(data), 'size': len(data)})
    add('server', '服务器新文件名与当前内容', engine.download(file))
    if local is not None:
        add('local', '本地旧文件内容（采用后使用服务器新文件名）', local)
    if destination is not None and source.casefold() != target.casefold():
        add('copy:target', '本地目标位置已有内容', destination)
    queue = [dict(row) for row in engine.db.execute('SELECT * FROM queue WHERE path IN (?,?) ORDER BY path', (source, target))]
    pending = None
    for job in engine.db.execute('SELECT * FROM conflict_resolution WHERE path=? ORDER BY rowid', (target,)):
        plan = json.loads(job['payload'])
        if job['status'] == 'pending' and plan.get('rename'):
            pending = job['id']
        if plan.get('data') is not None:
            add('job:' + job['id'], '上次处理保留的内容', base64.b64decode(plan['data'], validate=True))
    rename = {'id': identity, 'intent': intent, 'sourceSha256': sha(local), 'sourceIdentity': local_identity,
              'targetSha256': sha(destination)}
    proof = {'rename': rename, 'file': signature(file), 'scope': engine.remote.scope_version, 'queue': queue,
             'variants': [{key: item[key] for key in ('id', 'sha256', 'size')} for item in variants], 'pending': pending}
    draft = engine.db.execute('SELECT content FROM conflict_draft WHERE path=?', (target,)).fetchone()
    return {'path': target, 'file': file, 'variants': variants, 'pending': pending, 'rename': rename,
            'fingerprint': digest(json.dumps(proof, sort_keys=True).encode()), 'localSha256': sha(destination),
            'scopeVersion': engine.remote.scope_version, 'queue': queue,
            'conflict': {'path': target, 'reason': 'REMOTE_RENAME', 'copies': '[]'}, 'draft': draft[0] if draft else None}


def execute(engine, path, operation, plan):
    rename = plan['rename']; source = rename['intent']['source']
    case_only = source.casefold() == path.casefold()
    if source == path:
        raise SyncError('CONFLICT_CHANGED')
    def current():
        catalog = engine.snapshot()
        if engine.remote.scope_version != plan['scopeVersion'] or not engine.selection.explicit(source) or not engine.selection.explicit(path):
            raise SyncError('SYNC_SCOPE_CHANGED')
        value = catalog.get(rename['id'])
        if not value or value['path'] != path or value['deleted']:
            raise SyncError('CONFLICT_CHANGED')
        return value
    file = current()
    job = engine.db.execute('SELECT intent FROM local_rename WHERE id=?', (rename['id'],)).fetchone()
    # A normal scan may refresh remoteVersion after our committed-but-unacknowledged
    # publication. The original object, paths, baseline and identity must still match.
    if not job or any(json.loads(job['intent'])[key] != rename['intent'][key] for key in ('source', 'target', 'base', 'identity')):
        raise SyncError('CONFLICT_CHANGED')
    data = base64.b64decode(plan['data'], validate=True)
    chosen = digest(data)
    def local_state():
        old, identity = engine.fs.read_state(source)
        target = engine.fs.read(path)
        allowed_old = {rename['sourceSha256']}
        if plan.get('localPrepared'):
            allowed_old.add(chosen if case_only else None)
        if sha(old) not in allowed_old or sha(target) not in (rename['targetSha256'], chosen):
            raise SyncError('CONFLICT_CHANGED')
        if old is not None and sha(old) == rename['sourceSha256'] and identity != rename['sourceIdentity']:
            raise SyncError('CONFLICT_CHANGED')
        return old, target
    local_state()
    if plan['request']:
        published = engine.remote.request('/conflict-files', body=plan['request'], operation=operation)
        file = current()
        if signature(file) != signature(published):
            raise SyncError('CONFLICT_CHANGED')
    elif signature(file) != plan['remote']:
        raise SyncError('CONFLICT_CHANGED')
    old, target = local_state()
    if not plan.get('localPrepared'):
        # Both original paths are durably backed up before either is replaced/removed.
        if old is not None: engine.archive(source, old, file['version'])
        if target is not None and not case_only: engine.archive(path, target, file['version'])
        plan['localPrepared'] = True
        with engine.db:
            engine.db.execute('UPDATE conflict_resolution SET payload=? WHERE id=?', (json.dumps(plan), operation))
    if case_only and old is not None and sha(old) == rename['sourceSha256']:
        engine.fs.rename(source, path, rename['sourceIdentity'], rename['sourceSha256'])
    if target != data:
        engine.fs.atomic(path, data, sha(target))
    if not case_only and old is not None:
        fresh, identity = engine.fs.read_state(source)
        if fresh != old or identity != rename['sourceIdentity']:
            raise SyncError('CONFLICT_CHANGED')
        engine.fs.path(source).unlink()
    if sha(engine.fs.read(path)) != chosen or (not case_only and engine.fs.read(source) is not None):
        raise SyncError('CONFLICT_CHANGED')
    if signature(current()) != signature(file):
        raise SyncError('CONFLICT_CHANGED')
    with engine.db:
        for name in ('baseline', 'local_identity', 'missing', 'queue', 'conflict', 'conflict_draft'):
            engine.db.execute('DELETE FROM ' + name + ' WHERE path IN (?,?)', (source, path))
        engine.db.execute('INSERT INTO baseline VALUES (?,?)', (path, json.dumps(file)))
        engine.db.execute('DELETE FROM local_rename WHERE id=?', (rename['id'],))
        engine.db.execute("UPDATE conflict_resolution SET status='done' WHERE id=?", (operation,))
    engine.acknowledge(file)
    return {'status': 'CONFLICT_RESOLVED', **engine.status()}
