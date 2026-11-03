"""Real cursor pages, scope refresh, atomic SQLite publication and log-retention refusal."""

import base64
import http.cookiejar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from privatespace_sync.engine import Engine, configure
from privatespace_sync.filesystem import digest
from privatespace_sync.transport import SyncError

backend = os.environ['NOTES_BACKEND']
origin = 'http://127.0.0.1:' + os.environ['NOTES_FRONTEND_PORT']
output = Path(os.environ['INCREMENTAL_OUTPUT']).resolve()
assert output.is_relative_to(Path(__file__).resolve().parents[2] / 'frontend/test-results')
phase = sys.argv[1]
web = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(path, body=None, method=None):
    headers = {'Origin': origin, 'Content-Type': 'application/json', 'Idempotency-Key': str(uuid.uuid4())}
    if body is not None or method:
        headers['X-CSRF-TOKEN'] = request('/auth/csrf')['token']
    call = urllib.request.Request(backend + '/api/v1' + path, headers=headers,
                                  data=json.dumps(body).encode() if body is not None else None, method=method)
    with web.open(call, timeout=15) as response:
        return json.load(response)


request('/auth/initialize' if phase == 'initialize' else '/auth/login',
        {'username': 'notes-it', 'password': os.environ['NOTES_PASSWORD'], 'setupToken': os.environ['NOTES_SETUP']})


class Relay:
    def __init__(self, port=0):
        relay = self
        self.responses = []
        self.offline = False
        self.drop_page = 0
        self.partial_page = 0
        self.callback = None
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def forward(self):
                if relay.offline:
                    self.connection.close(); return
                size = int(self.headers.get('Content-Length', 0))
                call = urllib.request.Request(backend + self.path, data=self.rfile.read(size) if size else None, method=self.command,
                    headers={key: value for key, value in self.headers.items() if key.lower() not in ('host', 'connection', 'content-length')})
                try:
                    actual = urllib.request.urlopen(call, timeout=15)
                except urllib.error.HTTPError as error:
                    actual = error
                with actual:
                    payload = actual.read()
                    partial = False
                    kind = 'changes' if self.path.startswith('/api/v1/sync/changes?') else 'snapshot' if self.path == '/api/v1/sync/snapshot' else None
                    if kind:
                        result = json.loads(payload)
                        relay.responses.append({'kind': kind, 'status': actual.status, 'result': result})
                        if kind == 'changes' and actual.status == 200:
                            callback, relay.callback = relay.callback, None
                            if callback: callback()
                            if relay.drop_page:
                                relay.drop_page -= 1
                                if not relay.drop_page:
                                    self.connection.close(); return
                            if relay.partial_page:
                                relay.partial_page -= 1
                                partial = not relay.partial_page
                    self.send_response(actual.status)
                    for key, value in actual.headers.items():
                        if key.lower() not in ('connection', 'transfer-encoding', 'content-length'):
                            self.send_header(key, value)
                    self.send_header('Content-Length', str(len(payload))); self.end_headers()
                    self.wfile.write(payload[:len(payload) // 2] if partial else payload)
            do_GET = forward
            do_POST = forward
        self.server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.port = self.server.server_port
        self.url = 'http://127.0.0.1:' + str(self.port)
    def close(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()


def pair(name, url, scope=None):
    code = request('/sync-devices/pairing-code', {'name': '增量-' + name, 'scope': scope})['code']
    root, state = output / ('root-' + name), output / ('state-' + name)
    configure(url, root, state, code)
    return root, state, Engine(state, stable_seconds=.01, delete_grace=0)


def settle(client):
    result = client.cycle()
    assert result['status'] == 'OK' and not result.get('issues') and not result['conflicts'], result
    return result


def durable(client):
    return {table: [tuple(row) for row in client.db.execute('SELECT * FROM ' + table + ' ORDER BY 1')]
            for table in ('remote_catalog', 'baseline', 'queue', 'local_identity', 'setting')}


def edit(file, content):
    return request('/notes/' + file['id'], {'path': file['path'], 'type': 'note', 'baseVersion': file['version'], 'content': content}, method='PUT')


if phase in ('expired', 'purged'):
    state = json.loads((output / 'state.json').read_text(encoding='utf-8'))
    relay = Relay(state['relayPort'])
    client = Engine(output / 'state-all', stable_seconds=.01, delete_grace=0)
    try:
        if phase == 'purged':
            assert state['purged']['id'] not in client.snapshot()
            assert client.db.execute('SELECT COUNT(*) FROM queue').fetchone()[0] == 1
            baseline = client.baseline()[state['purged']['path']]
            assert baseline['deleted'], 'purging remote cache does not discard deletion protection baseline'
            late_client = Engine(output / 'state-late', stable_seconds=.01, delete_grace=0)
            try:
                settle(late_client)
                assert not (output / 'root-late' / state['purged']['path']).exists()
                assert state['purged']['id'] not in late_client.snapshot()
                assert list((output / 'state-late/recycle').glob('*.bin'))
            finally:
                late_client.close()
            (output / 'purged.json').write_text(json.dumps({'realRetentionPurged': True, 'cacheRemovalObserved': True,
                'uploadQueueAndDeletionBaselinePreserved': True, 'offlineDeletionSurvivesScopeRefreshAndMetadataPurge': True}, indent=2), encoding='utf-8')
            print('PASS: incremental-purged', flush=True)
            sys.exit(0)
        before = durable(client)
        result = client.cycle()
        assert result['code'] == 'SYNC_CURSOR_EXPIRED' and result['status'] == 'PAUSED', result
        assert durable(client) == before
        assert (output / 'root-all/离线待上传.md').read_bytes() == b'# pending offline\r\n'
        assert all(item['path'] != '离线待上传.md' for item in request('/notes?query=' + urllib.parse.quote('离线待上传.md'))['items'])
        assert request('/notes/' + state['late']['id'])['version'] == state['late']['version']
        (output / 'expired.json').write_text(json.dumps({'realRetentionPruned': True, 'cacheBaselineQueueUnchanged': True,
            'noAutoResurrectionOrDeletion': True}, indent=2), encoding='utf-8')
        print('PASS: incremental-expired', flush=True)
    finally:
        client.close(); relay.close()
    sys.exit(0)


for path in ('增量选择', '增量不选', '增量共享'):
    request('/notes', {'path': path, 'type': 'folder', 'content': ''})
notes = [request('/notes', {'path': f'增量选择/笔记{index}.md', 'type': 'note', 'content': '# base\r\n'}) for index in range(12)]
purged_note = request('/notes', {'path': '增量选择/待过期删除.md', 'type': 'note', 'content': '# retained tombstone'})
relay = Relay()
a = b = None
checks = []
try:
    root_a, state_a, a = pair('all', relay.url)
    root_b, state_b, b = pair('selected', backend, {'all': False, 'folders': ['增量选择']})
    settle(a); settle(b)
    assert sum(row['kind'] == 'snapshot' for row in relay.responses) == 1
    a.snapshot()
    assert relay.responses[-1]['result']['changes'] == []
    notes[0] = edit(notes[0], '# remote update\r\n')
    start = len(relay.responses)
    settle(a)
    assert (root_a / notes[0]['path']).read_bytes() == b'# remote update\r\n'
    assert sum(len(row['result']['changes']) for row in relay.responses[start:] if row['kind'] == 'changes') == 1
    (root_a / notes[0]['path']).write_bytes(b'# local update\r\n')
    settle(a); settle(b)
    assert (root_b / notes[0]['path']).read_bytes() == b'# local update\r\n'
    assert sum(row['kind'] == 'snapshot' for row in relay.responses) == 1
    checks.append('one initial full view, zero-change poll returns zero items, one real edit transfers one change; both directions persist real bytes')

    page_file = request('/notes', {'path': '增量不选/分页.md', 'type': 'note', 'content': '# page'})
    for index in range(205): page_file = edit(page_file, '# page ' + str(index))
    late = {}
    def append_during_page():
        late.update(request('/notes', {'path': '增量不选/分页期间新增.md', 'type': 'note', 'content': '# concurrent'}))
    relay.callback = append_during_page
    start = len(relay.responses)
    view = a.snapshot()
    pages = [row['result'] for row in relay.responses[start:] if row['kind'] == 'changes']
    assert len(pages) >= 2 and len(pages[0]['changes']) == 200 and all(page['until'] == pages[0]['until'] for page in pages)
    assert late['id'] not in view and view[page_file['id']]['version'] == page_file['version']
    assert late['id'] in a.snapshot()
    b_view = b.snapshot()
    assert page_file['id'] not in b_view and late['id'] not in b_view
    checks.append('bounded pages retain a stable upper watermark; concurrent append arrives next interval; out-of-scope events advance cursor without exposing files')

    for index in range(205): page_file = edit(page_file, '# second interval ' + str(index))
    before = durable(a)
    relay.drop_page = 2
    try:
        a.snapshot()
        raise AssertionError('dropped page unexpectedly succeeded')
    except SyncError as error:
        assert error.code == 'NETWORK_UNAVAILABLE', error.code
    assert durable(a) == before
    relay.partial_page = 2
    try:
        a.snapshot()
        raise AssertionError('truncated genuine page unexpectedly succeeded')
    except SyncError as error:
        assert error.code == 'NETWORK_UNAVAILABLE', error.code
    assert durable(a) == before
    a.close(); a = Engine(state_a, stable_seconds=.01, delete_grace=0)
    assert a.snapshot()[page_file['id']]['version'] == page_file['version']
    checks.append('second genuine HTTP page loss or body truncation commits no partial cache/cursor; SQLite restart replays interval without losing the latest file version')

    image = (Path(__file__).parent / 'fixtures/visual-check.png').read_bytes()
    shared = a.remote.request('/files', body={'id': None, 'path': '增量共享/图.png', 'baseVersion': '0', 'deleted': False,
        'sha256': digest(image), 'contentBase64': base64.b64encode(image).decode('ascii')}, operation=str(uuid.uuid4()))
    selected_note = request('/notes/' + notes[1]['id'])
    selected_note = edit(selected_note, '# shared\n\n![image](../增量共享/图.png)\n')
    settle(b)
    assert (root_b / shared['path']).read_bytes() == image
    assert shared['path'] in b.selection.attachments
    selected_note = edit(selected_note, '# reference removed\n')
    settle(b)
    assert shared['path'] not in b.selection.attachments and (root_b / shared['path']).read_bytes() == image
    checks.append('selected-note reference changes trigger real scope refresh; newly referenced attachment downloads and removed reference preserves existing local copy')

    source = request('/notes/' + notes[2]['id'])
    move = request('/notes/' + source['id'] + '/move-preview', {'targetPath': '增量选择/新名.md', 'baseVersion': source['version'], 'fingerprint': None})
    moved = request('/notes/' + source['id'] + '/move', {'targetPath': '增量选择/新名.md', 'baseVersion': source['version'], 'fingerprint': move['fingerprint']})
    settle(b)
    assert not (root_b / source['path']).exists() and (root_b / moved['path']).exists()
    deleted = request('/notes/' + moved['id'] + '?baseVersion=' + moved['version'], method='DELETE')
    settle(b)
    assert not (root_b / moved['path']).exists()
    restored = request('/notes/' + moved['id'] + '/restore?version=' + moved['version'] + '&baseVersion=' + deleted['version'], {})
    settle(b)
    assert (root_b / restored['path']).read_bytes() == b'# base\r\n'
    checks.append('immutable change metadata carries rename, tombstone and explicit restore; selected client follows ID, archives deletion and downloads restored bytes')

    # Capture a real upload while offline, then leave one server change beyond the cached cursor.
    _, _, late_client = pair('late', backend, {'all': False, 'folders': ['增量选择']})
    settle(late_client); late_client.close()
    later_reference = request('/notes/' + notes[4]['id'])
    edit(later_reference, '# changed while offline\n\n![image](../增量共享/图.png)\n')
    purged_note = request('/notes/' + purged_note['id'] + '?baseVersion=' + purged_note['version'], method='DELETE')
    settle(a)
    (root_a / '离线待上传.md').write_bytes(b'# pending offline\r\n')
    relay.offline = True
    assert a.cycle()['code'] == 'NETWORK_UNAVAILABLE'
    assert a.db.execute('SELECT COUNT(*) FROM queue').fetchone()[0] == 1
    server_note = request('/notes/' + notes[0]['id'])
    server_note = edit(server_note, '# server changes after checkpoint')
    (output / 'state.json').write_text(json.dumps({'relayPort': relay.port, 'late': server_note, 'purged': purged_note}), encoding='utf-8')
    (output / 'incremental.json').write_text(json.dumps({'checks': checks, 'packagedExecutableRoundtrip': False}, indent=2), encoding='utf-8')
    print('PASS: incremental-' + phase, flush=True)
finally:
    if a: a.close()
    if b: b.close()
    relay.close()
