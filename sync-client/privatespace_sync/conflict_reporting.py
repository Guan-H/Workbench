"""Durable metadata outbox. Reporting failure never changes the file-sync result."""

import json
from .filesystem import digest
from .transport import SyncError


def sync(engine, status=None, *, observations=True):
    if not engine.scope_known:
        return
    db = engine.db
    db.executescript('''
        CREATE TABLE IF NOT EXISTS conflict_reported (path TEXT PRIMARY KEY, metadata TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS conflict_report_outbox (id INTEGER PRIMARY KEY CHECK(id=1), scope TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS conflict_report_control (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    ''')
    def control(key):
        # Reporting metadata must not alter the business settings protected by readonly previews.
        return db.execute('SELECT value FROM conflict_report_control WHERE key=?', (key,)).fetchone() or db.execute('SELECT value FROM setting WHERE key=?', (key,)).fetchone()
    version = engine.remote.scope_version
    old_scope = control('conflict_report_scope')
    if old_scope and old_scope[0] != version:
        with db:
            db.execute('DELETE FROM conflict_report_outbox')
            db.execute('DELETE FROM conflict_reported')
    with db:
        db.execute("INSERT OR REPLACE INTO conflict_report_control VALUES ('conflict_report_scope',?)", (version,))

    def send(body):
        engine.remote.request('/conflict-status', body=body, timeout=5)
        with db:
            for item in body['items']:
                db.execute('INSERT OR REPLACE INTO conflict_reported VALUES (?,?)', (item['path'], json.dumps(item, sort_keys=True)))
            db.execute('DELETE FROM conflict_report_outbox')
            db.execute("INSERT OR REPLACE INTO conflict_report_control VALUES ('conflict_report_revision',?)", (body['revision'],))

    pending = db.execute('SELECT payload FROM conflict_report_outbox WHERE id=1').fetchone()
    if pending:
        try:
            send(json.loads(pending[0]))
        except SyncError as error:
            if error.code != 'CONFLICT_REPORT_STALE':
                raise
            with db:
                db.execute('DELETE FROM conflict_report_outbox')
                db.execute('DELETE FROM conflict_reported')
    feed = engine.remote.request('/conflict-status', timeout=5)
    previous = control('conflict_report_revision')
    revision = max(int(feed['revision']), int(previous[0]) if previous else 0)
    baseline = engine.baseline()
    current = {}
    for row in db.execute('SELECT * FROM conflict ORDER BY path'):
        if not observations:
            break
        path = row['path']
        if not engine.selection.includes(path):
            continue
        try:
            data = engine.fs.read(path)
            local_state = 'present' if data is not None else 'missing'
        except (SyncError, OSError):
            data, local_state = None, 'unavailable'
        base = baseline.get(path)
        current[path] = {'path': path, 'active': True, 'reason': row['reason'], 'localState': local_state,
            'localSha256': digest(data) if data is not None else None, 'baselineId': base['id'] if base else None,
            'baselineVersion': base['version'] if base else None, 'baselineSha256': base['sha256'] if base else None,
            'copies': len(json.loads(row['copies'])), 'resolution': None}
    known = {row['path']: json.loads(row['metadata']) for row in db.execute('SELECT * FROM conflict_reported')}
    if not observations:
        current = {path: item for path, item in known.items() if item['active']}
    changes = [item for path, item in current.items() if item != known.get(path)]
    for path, item in known.items():
        if item['active'] and path not in current and engine.selection.includes(path):
            job = db.execute("SELECT payload FROM conflict_resolution WHERE path=? AND status='done' ORDER BY rowid DESC LIMIT 1", (path,)).fetchone()
            choice = json.loads(job['payload']).get('choice') if job else None
            changes.append({**item, 'active': False, 'resolution': choice})
    # Empty reports explicitly establish "no observations pending" for new helpers.
    batches = [changes[index:index + 200] for index in range(0, len(changes), 200)] or [[]]
    for items in batches:
        revision += 1
        body = {'revision': str(revision), 'items': items, 'status': status}
        with db:
            db.execute('INSERT OR REPLACE INTO conflict_report_outbox VALUES (1,?,?)', (version, json.dumps(body)))
        send(body)
