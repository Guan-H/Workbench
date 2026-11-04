"""Read-only reconciliation inventory; never replace the active cursor or replay old tasks."""

import json
import time
import uuid

from .filesystem import digest, excluded
from .remote_catalog import RemoteCatalog
from .scope import SyncScope
from .transport import SyncError
from .initial_merge import InitialMerge


def preview(engine, checkpoint):
    # Fetching a fresh server snapshot is allowed, but storing it would discard the
    # expired view before the user has reviewed the differences.
    snapshot, *_ = RemoteCatalog(engine.db, engine.remote).full(checkpoint)
    selection = SyncScope(snapshot.get('scope'), snapshot.get('attachmentPaths', []))
    directories, exclusions = set(), []
    first, first_issues = engine.fs.scan(include=selection.includes, descend=selection.descends)
    time.sleep(engine.stable_seconds)
    checkpoint()
    local, issues = engine.fs.scan(include=selection.includes, descend=selection.descends,
        directories=directories, exclusions=exclusions)
    issues += first_issues
    issues += [{'path': path, 'code': 'FILE_BUSY'} for path in first.keys() | local.keys() if first.get(path) != local.get(path)]
    remote = {file['path']: file for file in snapshot['items'] if file['type'] != 'folder'
        and selection.includes(file['path']) and not excluded(file['path'])}
    baseline = engine.baseline()
    queue = [dict(row) for row in engine.db.execute('SELECT * FROM queue ORDER BY path')]
    renames = [dict(row) for row in engine.db.execute('SELECT * FROM rename_queue ORDER BY source')]
    old_paths = {row['path'] for row in queue} | {row[key] for row in renames for key in ('source', 'target')}
    changes = []
    for path in sorted(local.keys() | remote.keys() | {path for path in baseline if selection.includes(path)}):
        checkpoint()
        file, sha, base = remote.get(path), local.get(path), baseline.get(path)
        if file and file['deleted']:
            action = 'deleted-conflict' if sha else 'keep-tombstone'
        elif file and sha:
            action = 'same' if file['sha256'] == sha else 'conflict'
        elif file:
            action = 'download'
        elif base or path in old_paths:
            # An expired deletion or a move cannot safely be inferred from absence.
            action = 'uncertain-delete'
        else:
            action = 'local-only'
        changes.append({'path': path, 'action': action})
    changes += [{'path': path, 'action': 'keep-directory'} for path in sorted(directories)]
    changes += [{'path': file['path'], 'action': 'create-directory'} for file in snapshot['items']
        if file['type'] == 'folder' and not file['deleted'] and selection.directory(file['path'])
        and not excluded(file['path']) and file['path'] not in directories]
    changes += [{'path': item['path'], 'action': 'skip', 'code': item['code']} for item in issues + exclusions]
    changes += [{'path': row['path'], 'action': 'held-task'} for row in queue]
    changes += [{'path': row['source'] + ' → ' + row['target'], 'action': 'held-task'} for row in renames]
    fingerprint = digest(json.dumps({'device': engine.config['device'], 'root': engine.config['identity'],
        'snapshot': snapshot, 'local': local, 'baseline': baseline, 'queue': queue, 'renames': renames,
        'directories': sorted(directories), 'issues': issues, 'exclusions': exclusions},
        sort_keys=True, ensure_ascii=False).encode('utf-8'))
    summary = {}
    for item in changes:
        summary[item['action']] = summary.get(item['action'], 0) + 1
    return {'fingerprint': fingerprint, 'changes': changes, 'issues': issues, 'summary': summary,
        'scope': selection.data(), 'cursor': snapshot['cursor'], 'readOnly': True, 'canApply': not issues,
        '_snapshot': snapshot, '_local': local}


def apply(engine, fingerprint, checkpoint):
    """Archive the approved old state atomically, then use initial-merge protections."""
    review = preview(engine, checkpoint)
    if review['fingerprint'] != fingerprint or not review['canApply']:
        return {'status': 'RECONCILIATION_PREVIEW', 'code': 'RECONCILIATION_CHANGED',
            'reconciliationPreview': review, 'issues': review['issues'], **engine.status()}
    checkpoint()
    snapshot, local = review['_snapshot'], review['_local']
    selection = SyncScope(snapshot.get('scope'), snapshot.get('attachmentPaths', []))
    archived = {name: [dict(row) for row in engine.db.execute('SELECT * FROM ' + name)]
        for name in ('baseline', 'queue', 'rename_queue', 'local_rename', 'local_identity', 'missing', 'setting')}
    identity = str(uuid.uuid4())
    # Archive and transition commit together. A crash leaves either the old state,
    # or an initial merge that requires a new concrete review before continuing.
    with engine.db:
        engine.db.execute('INSERT INTO reconciliation_archive VALUES (?, ?, ?)',
            (identity, time.time(), json.dumps({'fingerprint': fingerprint, 'state': archived}, ensure_ascii=False)))
        for item in review['changes']:
            if item['action'] == 'uncertain-delete':
                engine.db.execute('INSERT OR IGNORE INTO conflict VALUES (?, ?, ?)',
                    (item['path'], 'RECONCILIATION_UNKNOWN_DELETE', '[]'))
        remote = {file['path']: file for file in snapshot['items'] if file['type'] != 'folder'}
        for row in archived['queue']:
            task = json.loads(row['request'])
            file = remote.get(row['path'])
            if not task['deleted'] and task['sha256'] not in (local.get(row['path']), file.get('sha256') if file else None):
                engine.db.execute('INSERT OR IGNORE INTO conflict VALUES (?, ?, ?)',
                    (row['path'], 'RECONCILIATION_ARCHIVED_EDIT', '[]'))
        for row in archived['rename_queue']:
            for path in (row['source'], row['target']):
                engine.db.execute('INSERT OR IGNORE INTO conflict VALUES (?, ?, ?)', (path, 'RECONCILIATION_ARCHIVED_RENAME', '[]'))
        for name in ('baseline', 'queue', 'rename_queue', 'local_rename', 'local_identity', 'missing'):
            engine.db.execute('DELETE FROM ' + name)
        engine.db.execute("DELETE FROM setting WHERE key IN ('cursor', 'delete_review', 'initial_merge_complete', 'initial_merge_attempt')")
        RemoteCatalog(engine.db, engine.remote).store(snapshot, True, {}, set(),
            {'mode': 'full', 'pages': 0, 'changes': len(snapshot['items']), 'cursor': snapshot['cursor']})
        engine.db.execute("INSERT OR REPLACE INTO setting VALUES ('cursor', ?)", (snapshot['cursor'],))
        engine.db.execute("INSERT OR REPLACE INTO setting VALUES ('scope_policy', ?)",
            (json.dumps({'version': snapshot.get('scopeVersion', '1'), 'scope': selection.data(),
                'attachments': list(selection.attachments), 'fileRenameSupported': snapshot.get('fileRenameSupported', False)}),))
        engine.db.execute("INSERT OR REPLACE INTO setting VALUES ('reconciliation_active', ?)", (identity,))
    engine.selection = selection
    engine.scope_known = True
    engine.remote.scope_version = snapshot.get('scopeVersion', '1')
    engine.rename_supported = snapshot.get('fileRenameSupported', False)
    initial = InitialMerge(engine)
    merge, current = initial.preview(checkpoint)
    expected = {file['id']: initial.file_state(file) for file in snapshot['items']
        if file['type'] != 'folder' and selection.includes(file['path'])}
    folders = {file['path'] for file in snapshot['items'] if file['type'] == 'folder' and not file['deleted']
        and selection.directory(file['path']) and not excluded(file['path'])}
    if (current != local or initial.expected_files != expected or initial.expected_directories != folders
            or initial.scope_state() != (selection.data(), snapshot.get('scopeVersion', '1'), sorted(selection.attachments))):
        raise SyncError('INITIAL_MERGE_CHANGED')
    def pause_check():
        checkpoint()
        return False
    return engine.cycle(initial_confirmation=merge['fingerprint'], should_pause=pause_check)
