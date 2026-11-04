"""Read-only reconciliation inventory; never replace the active cursor or replay old tasks."""

import json
import time

from .filesystem import digest, excluded
from .remote_catalog import RemoteCatalog
from .scope import SyncScope


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
        elif base:
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
    queue = [dict(row) for row in engine.db.execute('SELECT * FROM queue ORDER BY path')]
    renames = [dict(row) for row in engine.db.execute('SELECT * FROM rename_queue ORDER BY source')]
    changes += [{'path': row['path'], 'action': 'held-task'} for row in queue]
    changes += [{'path': row['source'] + ' → ' + row['target'], 'action': 'held-task'} for row in renames]
    fingerprint = digest(json.dumps({'device': engine.config['device'], 'root': engine.config['identity'],
        'snapshot': snapshot, 'local': local, 'baseline': baseline, 'queue': queue, 'renames': renames,
        'directories': sorted(directories), 'issues': issues, 'exclusions': exclusions},
        sort_keys=True, ensure_ascii=False).encode('utf-8'))
    return {'fingerprint': fingerprint, 'changes': changes, 'issues': issues,
        'scope': selection.data(), 'cursor': snapshot['cursor'], 'readOnly': True}
