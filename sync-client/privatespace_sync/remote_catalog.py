"""Stage a complete cursor interval before publishing the remote view to SQLite."""

import json
import urllib.parse
from .transport import SyncError


class RemoteCatalog:
    def __init__(self, database, remote):
        self.db = database
        self.remote = remote

    def fetch(self, checkpoint=None):
        state = self.db.execute("SELECT value FROM setting WHERE key = 'remote_view'").fetchone()
        if not state or not json.loads(state[0]).get('incrementalSupported'):
            return self.full(checkpoint)
        metadata = json.loads(state[0])
        staged = {row['id']: json.loads(row['metadata']) for row in self.db.execute('SELECT * FROM remote_catalog')}
        after = int(metadata['cursor'])
        until = None
        updates, removed = {}, set()
        pages, received = 0, 0
        while True:
            if checkpoint:
                checkpoint()
            query = {'after': str(after), 'limit': '200'}
            if until is not None:
                query['until'] = str(until)
            try:
                page = self.remote.request('/changes?' + urllib.parse.urlencode(query))
            except SyncError as error:
                if error.code in ('SYNC_SCOPE_CHANGED', 'SYNC_VIEW_CHANGED', 'SYNC_SNAPSHOT_REQUIRED') or error.status == 404:
                    return self.full(checkpoint)
                raise
            pages += 1
            try:
                next_cursor, boundary = int(page['cursor']), int(page['until'])
                complete = page['complete']
                if type(complete) is not bool or next_cursor < after or boundary < next_cursor:
                    raise ValueError()
                if until is not None and boundary != until or not complete and next_cursor == after or complete and next_cursor != boundary:
                    raise ValueError()
                for change in page['changes']:
                    identity = change['id']
                    if change['removed'] and change.get('file') is not None:
                        file = {**change['file'], '_purged': True}
                        staged[identity] = file; updates[identity] = file; removed.discard(identity)
                    elif change['removed']:
                        staged.pop(identity, None); updates.pop(identity, None); removed.add(identity)
                    else:
                        file = change['file']
                        if file['id'] != identity:
                            raise ValueError()
                        current = staged.get(identity)
                        if current is None or int(file['version']) >= int(current['version']):
                            staged[identity] = file; updates[identity] = file; removed.discard(identity)
                    received += 1
            except (KeyError, TypeError, ValueError):
                raise SyncError('INVALID_SYNC_RESPONSE') from None
            until = boundary
            after = next_cursor
            if complete:
                break
        for identity, file in list(staged.items()):
            if not file.get('_purged'):
                continue
            row = self.db.execute('SELECT metadata FROM baseline WHERE path = ?', (file['path'],)).fetchone()
            base = json.loads(row[0]) if row else None
            queued = self.db.execute('SELECT 1 FROM queue WHERE path = ?', (file['path'],)).fetchone()
            if base and base['id'] == identity and base['deleted'] and int(base['version']) >= int(file['version']) and not queued:
                staged.pop(identity); updates.pop(identity, None); removed.add(identity)
        if len(staged) > 5000:
            raise SyncError('PROTOTYPE_LIMIT')
        payload = {**metadata, 'cursor': str(until), 'items': list(staged.values())}
        return payload, False, updates, removed, {'mode': 'incremental', 'pages': pages, 'changes': received, 'cursor': str(until)}

    def full(self, checkpoint):
        if checkpoint:
            checkpoint()
        payload = self.remote.request('/snapshot')
        purged = set(payload.get('purgedIds', []))
        for file in payload['items']:
            if file['id'] in purged:
                file['_purged'] = True
        return payload, True, {}, set(), {'mode': 'full', 'pages': 1, 'changes': len(payload['items']), 'cursor': payload['cursor']}

    def store(self, payload, fresh, updates, removed, transfer):
        # The caller commits cache, cursor and scope together; no partially fetched view is visible.
        if fresh:
            self.db.execute('DELETE FROM remote_catalog')
            updates = {file['id']: file for file in payload['items']}
        for identity in removed:
            self.db.execute('DELETE FROM remote_catalog WHERE id = ?', (identity,))
        self.db.executemany('INSERT OR REPLACE INTO remote_catalog VALUES (?, ?)',
                            [(identity, json.dumps(file)) for identity, file in updates.items()])
        self.db.execute("INSERT OR REPLACE INTO setting VALUES ('remote_view', ?)",
                        (json.dumps({key: value for key, value in payload.items() if key != 'items'}),))
        self.db.execute("INSERT OR REPLACE INTO setting VALUES ('remote_transfer', ?)", (json.dumps(transfer),))
