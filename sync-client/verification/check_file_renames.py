"""Real MySQL/HTTP/Windows file IDs and two durable clients, with a real-response loss gate."""

import base64
import http.cookiejar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
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
output = Path(os.environ['RENAME_OUTPUT']).resolve()
assert output.is_relative_to(Path(__file__).resolve().parents[2] / 'frontend/test-results')
web = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(path, body=None, method=None):
    headers = {'Origin': origin, 'Content-Type': 'application/json', 'Idempotency-Key': str(uuid.uuid4())}
    if body is not None or method:
        headers['X-CSRF-TOKEN'] = request('/auth/csrf')['token']
    call = urllib.request.Request(backend + '/api/v1' + path, headers=headers,
                                  data=json.dumps(body).encode() if body is not None else None, method=method)
    with web.open(call, timeout=15) as response:
        return json.load(response)


if sys.argv[1] == 'initialize':
    request('/auth/initialize', {'username': 'notes-it', 'password': os.environ['NOTES_PASSWORD'], 'setupToken': os.environ['NOTES_SETUP']})
else:
    request('/auth/login', {'username': 'notes-it', 'password': os.environ['NOTES_PASSWORD']})


class Gate:
    def __init__(self):
        self.drop_next = False
        self.offline = False
        self.committed = False
        self.after_read = None
        gate = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def forward(self):
                if gate.offline:
                    self.connection.close(); return
                size = int(self.headers.get('Content-Length', 0))
                call = urllib.request.Request(backend + self.path,
                    data=self.rfile.read(size) if size else None, method=self.command,
                    headers={key: value for key, value in self.headers.items() if key.lower() not in ('host', 'content-length', 'connection')})
                try:
                    response = urllib.request.urlopen(call, timeout=15)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    body = response.read()
                    if gate.after_read and self.command == 'GET' and self.path.startswith('/api/v1/sync/changes?') and response.status == 200:
                        action, gate.after_read = gate.after_read, None
                        action()
                    if gate.drop_next and self.path == '/api/v1/sync/file-renames' and response.status == 200:
                        gate.drop_next = False; gate.committed = True
                        self.connection.close(); return
                    self.send_response(response.status)
                    for key, value in response.headers.items():
                        if key.lower() not in ('connection', 'transfer-encoding', 'content-length'):
                            self.send_header(key, value)
                    self.send_header('Content-Length', str(len(body))); self.end_headers()
                    self.wfile.write(body)
            do_GET = forward
            do_POST = forward
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)
    def close(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()


folder = '文件身份改名验收'
request('/notes', {'path': folder, 'type': 'folder', 'content': ''})
for index in range(12):
    request('/notes', {'path': f'{folder}/保留{index}.md', 'type': 'note', 'content': '# identical\r\n'})


def pair(name, url):
    code = request('/sync-devices/pairing-code', {'name': name, 'scope': {'all': False, 'folders': [folder]}})['code']
    root, state = output / ('root-' + name), output / ('state-' + name)
    configure(url, root, state, code)
    return root, state, Engine(state, stable_seconds=.01, delete_grace=0)


def settle(client, confirmation=None):
    result = client.cycle(confirmation=confirmation)
    assert result['status'] == 'OK' and not result.get('issues') and not result['conflicts'], result
    return result


def note_at(client, path):
    return next(file for file in client.snapshot().values() if file['path'] == path and not file['deleted'])


def rejected(client, body, code, operation=None):
    try:
        client.remote.request('/file-renames', body=body, operation=operation or str(uuid.uuid4()))
        raise AssertionError('rename unexpectedly accepted')
    except SyncError as error:
        assert error.code == code, (error.code, code)


gate = Gate()
a = b = None
checks = []
try:
    root_a, state_a, a = pair('A', gate.url)
    root_b, state_b, b = pair('B', backend)
    settle(a); settle(b)
    mid_source, mid_target = f'{folder}/保留11.md', f'{folder}/本轮中途改名.md'
    mid = note_at(a, mid_source)
    def rename_between_real_views():
        body = {'targetPath': mid_target, 'baseVersion': mid['version']}
        plan = request('/notes/' + mid['id'] + '/move-preview', body)
        request('/notes/' + mid['id'] + '/move', {**body, 'fingerprint': plan['fingerprint']})
    gate.after_read = rename_between_real_views
    result = settle(a)
    assert result['rescanRequired'] and (root_a / mid_source).is_file() and not (root_a / mid_target).exists()
    settle(a); settle(b)
    assert not (root_a / mid_source).exists() and (root_a / mid_target).read_bytes() == b'# identical\r\n'
    assert note_at(a, mid_target)['id'] == mid['id']
    checks.append('a real server rename between two actual HTTP views defers the path without writes, then the next stable cycle preserves its ID and original bytes instead of falsely pausing for reconciliation')
    old = f'{folder}/原名.txt'; new = f'{folder}/新名.md'
    (root_a / old).write_bytes(b'# original\r\n')
    settle(a); settle(b)
    original = note_at(a, old)
    request('/notes/' + original['id'] + '/favorite?value=true', method='PUT')
    (root_a / old).rename(root_a / new)
    (root_a / new).write_bytes(b'# renamed and edited\r\n')
    settle(a); settle(b)
    renamed = note_at(a, new)
    assert renamed['id'] == original['id'] and renamed['type'] == 'note' and renamed['favorite']
    assert (root_b / new).read_bytes() == b'# renamed and edited\r\n' and not (root_b / old).exists()
    assert not any(file['path'] == old for file in a.snapshot().values())
    assert len(request('/notes/' + original['id'] + '/history')['items']) == 2
    checks.append('TXT-to-MD plus edit preserves server ID, favorite, history and exact CRLF; second client follows the same ID')

    upper = f'{folder}/新名.MD'
    (root_a / new).rename(root_a / upper)
    settle(a); settle(b)
    assert (root_b / folder / '新名.MD').name in [file.name for file in (root_b / folder).iterdir()]
    assert note_at(a, upper)['id'] == original['id']
    moved = f'{folder}/新增父目录/移动后.md'
    (root_a / moved).parent.mkdir(); (root_a / upper).rename(root_a / moved)
    settle(a); settle(b)
    assert note_at(a, moved)['id'] == original['id'] and (root_b / moved).read_bytes() == (root_a / moved).read_bytes()
    checks.append('case-only rename and move into a newly created subdirectory propagate without ID replacement')

    lost = f'{folder}/响应丢失.md'
    (root_a / moved).rename(root_a / lost)
    gate.drop_next = True
    result = a.cycle()
    assert gate.committed and result['code'] == 'NETWORK_UNAVAILABLE', result
    committed_version = note_at(b, lost)['version']
    a.close(); a = Engine(state_a, stable_seconds=.01, delete_grace=0)
    settle(a); settle(b)
    assert note_at(a, lost)['version'] == committed_version and note_at(a, lost)['id'] == original['id']
    offline = f'{folder}/离线改名.md'
    (root_a / lost).rename(root_a / offline)
    gate.offline = True
    assert a.cycle()['code'] == 'NETWORK_UNAVAILABLE'
    assert a.db.execute('SELECT COUNT(*) FROM rename_queue').fetchone()[0] == 1
    a.close(); gate.offline = False; a = Engine(state_a, stable_seconds=.01, delete_grace=0)
    settle(a); settle(b)
    assert note_at(a, offline)['id'] == original['id']
    checks.append('lost real commit response and offline rename survive SQLite restart; idempotent retry adds no extra version')

    unpublished = f'{folder}/首次上传前.txt'; unpublished_target = f'{folder}/首次上传前改名.md'
    gate.offline = True
    (root_a / unpublished).write_bytes(b'# first offline file\r\n')
    assert a.cycle()['code'] == 'NETWORK_UNAVAILABLE'
    (root_a / unpublished).rename(root_a / unpublished_target)
    assert a.cycle()['code'] == 'NETWORK_UNAVAILABLE'
    a.close(); gate.offline = False; a = Engine(state_a, stable_seconds=.01, delete_grace=0)
    assert settle(a)['rescanRequired']
    first_id = note_at(a, unpublished)['id']
    settle(a); settle(b)
    assert note_at(a, unpublished_target)['id'] == first_id
    assert not any(file['path'] == unpublished for file in a.snapshot().values())

    reused = f'{folder}/保留3.md'; reused_target = f'{folder}/旧名重用.md'
    reused_id = note_at(a, reused)['id']
    gate.offline = True
    (root_a / reused).write_bytes(b'# queued original edit\r\n')
    assert a.cycle()['code'] == 'NETWORK_UNAVAILABLE'
    (root_a / reused).rename(root_a / reused_target)
    (root_a / reused).write_bytes(b'# different new file at old name\r\n')
    assert a.cycle()['code'] == 'NETWORK_UNAVAILABLE'
    a.close(); gate.offline = False; a = Engine(state_a, stable_seconds=.01, delete_grace=0)
    assert settle(a)['rescanRequired']
    settle(a); settle(b)
    assert note_at(a, reused_target)['id'] == reused_id and note_at(a, reused)['id'] != reused_id
    assert (root_b / reused_target).read_bytes() == b'# queued original edit\r\n'
    assert (root_a / reused).read_bytes() == b'# different new file at old name\r\n'
    checks.append('offline first-upload rename and pending edit plus old-name reuse retain the original identity without duplicate upload or false conflict')

    current = note_at(a, offline)
    outside = request('/notes', {'path': '改名范围外.md', 'type': 'note', 'content': '# outside'})
    rename_request = {'id': current['id'], 'sourcePath': offline, 'targetPath': '改名范围外目标.md',
                      'baseVersion': current['version'], 'sha256': current['sha256'], 'contentBase64': None}
    rejected(a, rename_request, 'OUTSIDE_SYNC_SCOPE')
    rejected(a, {**rename_request, 'id': outside['id'], 'targetPath': folder + '/伪造目标.md', 'baseVersion': outside['version']}, 'VERSION_CONFLICT')
    rejected(a, {**rename_request, 'targetPath': f'{folder}/保留0.md'}, 'PATH_CONFLICT')
    rejected(a, {**rename_request, 'targetPath': folder + '/旧版本.md', 'baseVersion': '0'}, 'VERSION_CONFLICT')
    checks.append('scope escape, forged source identity, occupied path and stale version are rejected by real backend transactions')

    api_source = note_at(a, f'{folder}/保留4.md')
    api_body = {'id': api_source['id'], 'sourcePath': api_source['path'], 'targetPath': f'{folder}/接口改名.md',
                'baseVersion': api_source['version'], 'sha256': api_source['sha256'], 'contentBase64': None}
    operation = str(uuid.uuid4())
    first_result = a.remote.request('/file-renames', body=api_body, operation=operation)
    assert a.remote.request('/file-renames', body=api_body, operation=operation)['version'] == first_result['version']
    rejected(a, {**api_body, 'targetPath': f'{folder}/不同幂等请求.md'}, 'IDEMPOTENCY_CONFLICT', operation)
    settle(a); settle(b)
    for name, data, code in [('非UTF8', b'\xff\xfe\x00', 'UNSUPPORTED_FORMAT'), ('超限', b'a' * (1024 * 1024 + 1), 'FILE_TOO_LARGE')]:
        file = a.remote.request('/files', body={'id': None, 'path': f'{folder}/{name}.txt', 'baseVersion': '0', 'deleted': False,
                    'sha256': digest(data), 'contentBase64': base64.b64encode(data).decode('ascii')}, operation=str(uuid.uuid4()))
        rejected(a, {'id': file['id'], 'sourcePath': file['path'], 'targetPath': f'{folder}/{name}.md',
                     'baseVersion': file['version'], 'sha256': file['sha256'], 'contentBase64': None}, code)
        unchanged = note_at(a, file['path'])
        assert unchanged['type'] == 'attachment' and unchanged['version'] == file['version']
    settle(a); settle(b)
    checks.append('idempotency rejects changed payload; invalid UTF-8 and over-limit TXT cannot become Markdown and leave original metadata intact')

    # Same bytes do not establish identity: a copied replacement is a distinct logical file.
    source = f'{folder}/保留1.md'; copied = f'{folder}/相同内容副本.md'
    old_id = note_at(a, source)['id']
    shutil.copyfile(root_a / source, root_a / copied); (root_a / source).unlink()
    settle(a); settle(a); settle(b)
    assert note_at(a, copied)['id'] != old_id
    checks.append('copy-then-delete with identical bytes is not falsely merged into a file-ID rename')

    # A changed unsubmitted preview invalidates its old fingerprint and retains all server paths.
    for index in range(22):
        (root_a / folder / f'批量{index}.md').write_bytes(b'# bulk\r\n')
    settle(a); settle(b)
    for index in range(22):
        (root_a / folder / f'批量{index}.md').rename(root_a / folder / f'改名{index}.md')
    review = a.cycle()
    assert review['status'] == 'REQUIRES_CONFIRMATION' and len(review['deletionPreview']['changes']) == 22
    request('/notes', {'path': '文件身份暂存范围', 'type': 'folder', 'content': ''})
    switched = request('/sync-devices/' + a.config['device'] + '/scope',
        {'scope': {'all': False, 'folders': ['文件身份暂存范围']}, 'baseVersion': a.remote.scope_version}, method='PUT')
    held = settle(a)
    assert held['heldQueued'] == 22 and held['queued'] == 0
    request('/sync-devices/' + a.config['device'] + '/scope',
        {'scope': {'all': False, 'folders': [folder]}, 'baseVersion': switched['scopeVersion']}, method='PUT')
    assert a.cycle()['status'] == 'REQUIRES_CONFIRMATION'
    (root_a / folder / '改名0.md').rename(root_a / folder / '再次改名0.md')
    stale = a.cycle(confirmation=review['deletionPreview']['fingerprint'])
    assert stale['status'] == 'REQUIRES_CONFIRMATION'
    assert all(any(file['path'] == f'{folder}/批量{index}.md' for file in a.snapshot().values()) for index in range(22))
    settle(a, stale['deletionPreview']['fingerprint'])
    remote_review = b.cycle()
    assert remote_review['status'] == 'REQUIRES_CONFIRMATION' and all(item['direction'] == 'rename-local' for item in remote_review['deletionPreview']['changes'])
    settle(b, remote_review['deletionPreview']['fingerprint'])
    assert (root_b / folder / '再次改名0.md').read_bytes() == b'# bulk\r\n'
    checks.append('bulk rename requires review on both sides; scope exclusion holds all queued renames and reselecting still requires confirmation; changed local target invalidates prior confirmation')

    # A concurrent server edit cannot be overwritten by an old-version local rename.
    conflict_source = f'{folder}/保留2.md'; conflict_target = f'{folder}/并发改名.md'
    base = note_at(a, conflict_source)
    conflict_bytes = (root_a / conflict_source).read_bytes()
    request('/notes/' + base['id'], {'path': base['path'], 'type': 'note', 'baseVersion': base['version'], 'content': '# server edit'}, method='PUT')
    (root_a / conflict_source).rename(root_a / conflict_target)
    result = a.cycle()
    assert result['status'] == 'PAUSED' and result['code'] == 'RENAME_REQUIRES_RECONCILIATION', result
    assert request('/notes/' + base['id'])['path'] == conflict_source
    assert (root_a / conflict_target).read_bytes() == conflict_bytes
    assert not any(file['path'] == conflict_target for file in a.snapshot().values())
    checks.append('concurrent server edit pauses rename without replacing either version or publishing a duplicate')
    (output / 'renames.json').write_text(json.dumps({'checks': checks, 'realBackend': True, 'packagedExecutableRoundtrip': False}, indent=2), encoding='utf-8')
    print('PASS: file-renames', flush=True)
finally:
    if a: a.close()
    if b: b.close()
    gate.close()
