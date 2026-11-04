"""Immutable bootstrap pages against real HTTP/MySQL, Windows files and durable SQLite.

The relay only drops/truncates genuine responses or runs concurrent real operations.
It never substitutes a successful business response.
"""

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
from privatespace_sync.remote_catalog import RemoteCatalog
from privatespace_sync.transport import SyncError

backend = os.environ['NOTES_BACKEND']
origin = 'http://127.0.0.1:' + os.environ['NOTES_FRONTEND_PORT']
output = Path(os.environ['SNAPSHOT_OUTPUT']).resolve()
assert output.is_relative_to(Path(__file__).resolve().parents[2] / 'frontend/test-results')
phase = sys.argv[1]
web = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(path, body=None, method=None):
    headers = {'Origin': origin, 'Content-Type': 'application/json', 'Idempotency-Key': str(uuid.uuid4())}
    if body is not None or method:
        headers['X-CSRF-TOKEN'] = request('/auth/csrf')['token']
    call = urllib.request.Request(backend + '/api/v1' + path, headers=headers,
        data=json.dumps(body).encode() if body is not None else None, method=method)
    with web.open(call, timeout=30) as response:
        return json.load(response)


request('/auth/initialize' if phase == 'initialize' else '/auth/login',
    {'username': 'notes-it', 'password': os.environ['NOTES_PASSWORD'], 'setupToken': os.environ['NOTES_SETUP']})


class Relay:
    def __init__(self):
        relay = self
        self.pages = []
        self.callback = None
        self.drop = self.partial = 0
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def forward(self):
                size = int(self.headers.get('Content-Length', 0))
                call = urllib.request.Request(backend + self.path, data=self.rfile.read(size) if size else None,
                    method=self.command, headers={key: value for key, value in self.headers.items()
                    if key.lower() not in ('host', 'connection', 'content-length')})
                try:
                    actual = urllib.request.urlopen(call, timeout=30)
                except urllib.error.HTTPError as error:
                    actual = error
                with actual:
                    body, partial = actual.read(), False
                    if self.path.startswith('/api/v1/sync/snapshot-pages?') and actual.status == 200:
                        relay.pages.append(json.loads(body))
                        callback, relay.callback = relay.callback, None
                        if callback: callback()
                        if relay.drop:
                            relay.drop -= 1
                            if not relay.drop:
                                self.connection.close(); return
                        if relay.partial:
                            relay.partial -= 1
                            partial = not relay.partial
                    self.send_response(actual.status)
                    for key, value in actual.headers.items():
                        if key.lower() not in ('connection', 'transfer-encoding', 'content-length'):
                            self.send_header(key, value)
                    self.send_header('Content-Length', str(len(body))); self.end_headers()
                    self.wfile.write(body[:len(body) // 2] if partial else body)
            do_GET = forward
            do_POST = forward
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)
    def close(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()


def pair(name, relay, scope=None):
    code = request('/sync-devices/pairing-code', {'name': '分页-' + name, 'scope': scope})['code']
    root, state = output / ('root-' + name), output / ('state-' + name)
    configure(relay.url, root, state, code)
    return root, state, Engine(state, stable_seconds=.01, delete_grace=0)


def durable(client):
    return {table: [tuple(row) for row in client.db.execute('SELECT * FROM ' + table + ' ORDER BY 1')]
        for table in ('remote_catalog', 'baseline', 'queue', 'local_identity', 'setting')}


def expect(code, action):
    try:
        action()
        raise AssertionError('Expected ' + code)
    except SyncError as error:
        assert error.code == code, (error.code, code)


relay = Relay()
a = b = None
checks = []
try:
    if phase == 'expired':
        a = Engine(output / 'state-all', stable_seconds=.01, delete_grace=0)
        a.remote.url = relay.url
        state = json.loads((output / 'expiry.json').read_text(encoding='utf-8'))
        before = durable(a)
        expect('SYNC_SNAPSHOT_EXPIRED', lambda: a.remote.request('/snapshot-pages?' + urllib.parse.urlencode(
            {'snapshot': state['snapshot'], 'after': state['after'], 'limit': '200'})))
        assert durable(a) == before
        result = RemoteCatalog(a.db, a.remote).full(None)
        assert result[4]['pages'] > 25
        assert durable(a) == before, 'fetch alone does not publish any state'
        (output / 'expired.json').write_text(json.dumps({'realExpiryRejected': True,
            'durableStatePreserved': True, 'newBootstrapSucceeds': True}, indent=2), encoding='utf-8')
        print('PASS: snapshot-pages-expired', flush=True)
        sys.exit(0)

    root, state, a = pair('all', relay)
    pending = root / '分页验证/离线待上传.md'
    pending.parent.mkdir(); pending.write_bytes(b'# queued locally\r\n')
    a.enqueue('分页验证/离线待上传.md', None, pending.read_bytes())
    before = durable(a)
    relay.drop = 2
    expect('NETWORK_UNAVAILABLE', a.snapshot)
    assert durable(a) == before and a.remote.scope_version is None
    relay.partial = 2
    expect('NETWORK_UNAVAILABLE', a.snapshot)
    assert durable(a) == before and a.remote.scope_version is None
    a.close(); a = Engine(state, stable_seconds=.01, delete_grace=0)
    checks.append('second genuine page drop/truncation leaves SQLite cache, baseline, queue and scope untouched; restart reopens durable state')

    # A new bootstrap invalidates the previous page token rather than mixing views.
    old = relay.pages[-1]
    a.remote.request('/snapshot-pages?limit=1')
    expect('SYNC_SNAPSHOT_EXPIRED', lambda: a.remote.request('/snapshot-pages?snapshot=' + old['snapshot'] + '&after=200'))
    for query in ('limit=0', 'limit=501', 'after=1', 'after=-1', 'snapshot=invalid'):
        expect('INVALID_SYNC_CURSOR', lambda query=query: a.remote.request('/snapshot-pages?' + query))

    original = next(item for item in request('/notes?query=' + urllib.parse.quote('分页验证/正文.md'))['items'] if item['path'] == '分页验证/正文.md')
    deleted = next(item for item in request('/notes?query=' + urllib.parse.quote('分页验证/删除.md'))['items'] if item['path'] == '分页验证/删除.md')
    concurrent = {}
    def edit_during_pages():
        concurrent['edited'] = request('/notes/' + original['id'], {'path': original['path'], 'type': 'note',
            'baseVersion': original['version'], 'content': '# 分页期间编辑\r\n\r\n[附件](../分页其他/附件.bin)\r\n'}, 'PUT')
        concurrent['deleted'] = request('/notes/' + deleted['id'] + '?baseVersion=' + deleted['version'], method='DELETE')
        concurrent['created'] = request('/notes', {'path': '分页验证/分页期间新增.md', 'type': 'note', 'content': '# later\r\n'})
    relay.pages.clear(); relay.callback = edit_during_pages
    view = a.snapshot()
    assert len(relay.pages) > 25 and int(relay.pages[0]['total']) > 5000
    assert all(len(page['items']) <= 200 and page['cursor'] == relay.pages[0]['cursor'] and
        page['snapshot'] == relay.pages[0]['snapshot'] for page in relay.pages)
    assert view[original['id']]['version'] == original['version'] and not view[deleted['id']]['deleted']
    assert concurrent['created']['id'] not in view
    fresh = a.snapshot()
    assert fresh[original['id']]['version'] == concurrent['edited']['version'] and fresh[deleted['id']]['deleted']
    assert concurrent['created']['id'] in fresh
    expect('PROTOTYPE_LIMIT', lambda: a.remote.request('/snapshot'))
    checks.append('more than 5000 real objects arrive in bounded immutable pages; concurrent edit/delete/create arrive through the next incremental interval; legacy limit remains explicit')

    review = a.cycle()
    assert review['status'] == 'INITIAL_MERGE_REVIEW_REQUIRED', review
    result = a.cycle(initial_confirmation=review['initialMergePreview']['fingerprint'])
    assert result['status'] == 'OK' and not result['issues'] and not result['conflicts'], result
    assert len(list((root / '分页验证').glob('空目录*'))) == 5005
    assert (root / original['path']).read_bytes() == concurrent['edited']['content'].encode('utf-8')
    assert (root / '分页其他/附件.bin').read_bytes() == b'shared attachment\r\n'
    assert pending.read_bytes() == b'# queued locally\r\n'
    assert not a.db.execute('SELECT 1 FROM queue').fetchone()
    checks.append('real engine creates 5005 empty Windows folders and downloads exact note/attachment bytes; durable queued local file uploads without duplication')

    _, _, b = pair('scope', relay)
    before_b = durable(b)
    def change_scope():
        request('/sync-devices/' + b.config['device'] + '/scope',
            {'scope': {'all': False, 'folders': ['分页验证']}, 'baseVersion': '1'}, 'PUT')
    relay.callback = change_scope
    expect('SYNC_SCOPE_CHANGED', b.snapshot)
    assert durable(b) == before_b and b.remote.scope_version is None
    selected = b.snapshot()
    assert int(b.remote.scope_version) == 2
    assert not any(file['path'] == '分页其他/不选.md' for file in selected.values())
    assert any(file['path'] == '分页其他/附件.bin' for file in selected.values())
    shared = next(file for file in selected.values() if file['path'] == '分页其他/附件.bin')
    assert b.remote.request('/files/' + shared['id'] + '?version=' + shared['version'], binary=True) == b'shared attachment\r\n'
    outside = next(file for file in a.baseline().values() if file['path'] == '分页其他/不选.md')
    expect('OUTSIDE_SYNC_SCOPE', lambda: b.remote.request('/files/' + outside['id'] + '?version=' + outside['version'], binary=True))
    checks.append('scope change mid-bootstrap publishes no partial state; retry includes only selected paths plus the actual shared attachment')

    token = a.remote.request('/snapshot-pages?limit=1')
    expect('SYNC_SNAPSHOT_EXPIRED', lambda: b.remote.request('/snapshot-pages?snapshot=' + token['snapshot'] + '&after=1'))
    request('/sync-devices/' + b.config['device'], method='DELETE')
    expect('DEVICE_UNAUTHORIZED', lambda: b.remote.request('/snapshot-pages?limit=1'))
    checks.append('snapshot token cannot be used by another device; revoked device cannot start or continue pagination')
    # Leave a real persisted snapshot for Java to expire between two Python processes.
    token = a.remote.request('/snapshot-pages?limit=1')
    (output / 'expiry.json').write_text(json.dumps({'snapshot': token['snapshot'], 'after': token['after']}), encoding='utf-8')
    (output / 'snapshot-pages.json').write_text(json.dumps({'checks': checks,
        'catalogObjects': relay.pages[0]['total'], 'full5000FilePayloadBenchmark': False,
        'packagedExecutableRoundtrip': False}, ensure_ascii=False, indent=2), encoding='utf-8')
    print('PASS: snapshot-pages-' + phase, flush=True)
finally:
    if a: a.close()
    if b: b.close()
    relay.close()
