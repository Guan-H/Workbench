"""Real Tk initial merge, exact bytes, readonly cancellation and kill-after-commit recovery."""

import base64
import http.cookiejar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk
import urllib.error
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from privatespace_sync.desktop import SyncApp
from privatespace_sync.engine import Engine, configure
from privatespace_sync.filesystem import digest, MARKER
from privatespace_sync.transport import SyncError

backend = os.environ['NOTES_BACKEND']
origin = 'http://127.0.0.1:' + os.environ['NOTES_FRONTEND_PORT']
output = Path(os.environ['MERGE_OUTPUT']).resolve()
assert output.is_relative_to(Path(__file__).resolve().parents[2] / 'frontend/test-results')
web = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(path, body=None, method=None):
    headers = {'Origin': origin, 'Content-Type': 'application/json', 'Idempotency-Key': str(uuid.uuid4())}
    if body is not None or method:
        headers['X-CSRF-TOKEN'] = request('/auth/csrf')['token']
    call = urllib.request.Request(backend + '/api/v1' + path, headers=headers,
        data=json.dumps(body).encode() if body is not None else None, method=method)
    with web.open(call, timeout=20) as response:
        return json.load(response)


request('/auth/initialize' if sys.argv[1] == 'initialize' else '/auth/login',
    {'username': 'notes-it', 'password': os.environ['NOTES_PASSWORD'], 'setupToken': os.environ['NOTES_SETUP']})


def create(path, content='', kind='note'):
    return request('/notes', {'path': path, 'type': kind, 'content': content})


def edit(file, content):
    return request('/notes/' + file['id'], {'path': file['path'], 'type': 'note', 'baseVersion': file['version'], 'content': content}, 'PUT')


def pair(name, root=None, url=None, scope=None):
    root, state = root or output / ('root-' + name), output / ('state-' + name)
    code = request('/sync-devices/pairing-code', {'name': '合并-' + name, 'scope': scope})['code']
    configure(url or backend, root, state, code, allow_existing=True)
    return root, state, Engine(state, stable_seconds=.01, delete_grace=0)


def upload(remote, path, data):
    return remote.request('/files', body={'id': None, 'path': path, 'baseVersion': '0', 'deleted': False,
        'sha256': digest(data), 'contentBase64': base64.b64encode(data).decode('ascii')}, operation=str(uuid.uuid4()))


def inventory(root):
    result = {}
    for directory, dirs, names in os.walk(root, followlinks=False):
        parent = Path(directory)
        dirs[:] = [name for name in dirs if not (parent / name).is_symlink() and not (parent / name).is_junction()]
        for name in names:
            path = parent / name
            if name != MARKER:
                result[path.relative_to(root).as_posix()] = digest(path.read_bytes())
    return result


def table(state, name):
    with sqlite3.connect(state / 'sync.sqlite') as db:
        return db.execute('SELECT * FROM ' + name + ' ORDER BY 1').fetchall()


class CommitRelay:
    """Pause delivery only after the real backend has committed an upload."""
    def __init__(self):
        relay = self
        self.committed = threading.Event(); self.release = threading.Event()
        self.hold = True; self.posts = 0
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def forward(self):
                size = int(self.headers.get('Content-Length', 0))
                call = urllib.request.Request(backend + self.path, data=self.rfile.read(size) if size else None,
                    method=self.command, headers={key: value for key, value in self.headers.items()
                    if key.lower() not in ('host', 'connection', 'content-length')})
                try:
                    actual = urllib.request.urlopen(call, timeout=20)
                except urllib.error.HTTPError as error:
                    actual = error
                with actual:
                    body = actual.read()
                    if self.command == 'POST' and self.path == '/api/v1/sync/files':
                        relay.posts += 1
                        if relay.hold and relay.posts == 2 and actual.status == 200:
                            relay.committed.set(); relay.release.wait(20)
                    try:
                        self.send_response(actual.status)
                        for key, value in actual.headers.items():
                            if key.lower() not in ('connection', 'transfer-encoding', 'content-length'):
                                self.send_header(key, value)
                        self.send_header('Content-Length', str(len(body))); self.end_headers()
                        self.wfile.write(body)
                    except (BrokenPipeError, ConnectionError, OSError):
                        pass  # The deliberately killed test process has closed its real connection.
            do_GET = forward
            do_POST = forward
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)
    def close(self):
        self.release.set(); self.server.shutdown(); self.server.server_close(); self.thread.join()


checks = []
seeder = selected = resumed = None
window = app = relay = child = None
try:
    create('合并预检', kind='folder'); create('合并共享', kind='folder')
    same = create('合并预检/一致.md', '# same\r\n')
    collision = create('合并预检/同名.md', '# remote\r\n')
    remote_only = create('合并预检/仅远程.md', '# download\r\n')
    deleted = create('合并预检/已删除.md', '# deleted')
    deleted = request('/notes/' + deleted['id'] + '?baseVersion=' + deleted['version'], method='DELETE')
    _, _, seeder = pair('seeder')
    binary = upload(seeder.remote, '合并预检/同名.bin', b'\x00remote\xff')
    shared = upload(seeder.remote, '合并共享/图.bin', b'\x00shared\xff')
    create('合并预检/引用.md', '# ref\n[shared](../合并共享/图.bin)\n')
    root, state = output / 'root-tk', output / 'state-tk'
    (root / '合并预检').mkdir(parents=True)
    fixtures = {'一致.md': b'# same\r\n', '同名.md': b'# local\r\n', '本地.md': b'# upload\r\n',
        '已删除.md': b'# keep local deleted-path bytes\r\n', '同名.bin': b'\x00local\xff'}
    for name, data in fixtures.items(): (root / '合并预检' / name).write_bytes(data)
    for index in range(23): (root / '合并预检' / f'多页{index}.md').write_bytes(b'# page\r\n')
    (root / '合并预检/超限.md').write_bytes(b'x' * (1024 * 1024 + 1))
    (root / '合并预检/e\u0301.md').write_bytes(b'# preserve invalid NFC')
    (root / '.obsidian').mkdir(); (root / '.obsidian/config.json').write_bytes(b'{"keep":true}')
    outside = output / 'outside'; outside.mkdir(); (outside / 'never-read.md').write_bytes(b'# outside root')
    subprocess.run(['cmd', '/c', 'mklink', '/J', str(root / '合并预检/外部链接'), str(outside)], check=True, capture_output=True)
    before = inventory(root)
    window = tk.Tk(); window.withdraw(); app = SyncApp(window, state)
    def wait(predicate, label):
        deadline = time.monotonic() + 65
        while time.monotonic() < deadline:
            window.update()
            if predicate(): return
            time.sleep(.04)
        raise AssertionError(label + ': ' + app.phase + '/' + str(app.snapshot.get('code')))
    def once():
        app.once_button.invoke()
        wait(lambda: app.phase in ('ATTENTION', 'READY', 'ERROR') and not app.once_button.instate(['disabled']), 'cycle')
    def review():
        value = app.snapshot['result']
        assert value['status'] == 'INITIAL_MERGE_REVIEW_REQUIRED', value
        return value['initialMergePreview']
    wait(lambda: app.phase == 'UNPAIRED' and not app.pair_button.instate(['disabled']), 'unpaired')
    app.url.set(backend); app.directory.set(str(root))
    app.code.set(request('/sync-devices/pairing-code', {'name': '合并-Tk'})['code']); app.pair_button.invoke()
    wait(lambda: app.snapshot.get('root') is not None, 'pair nonempty')
    assert inventory(root) == before
    once(); first = review()
    actions = {item['path']: item['action'] for item in first['changes']}
    assert actions[same['path']] == 'same' and actions[collision['path']] == 'conflict'
    assert actions[remote_only['path']] == 'download' and actions['合并预检/本地.md'] == 'upload'
    assert actions[deleted['path']] == 'deleted-conflict'
    assert first['summary']['skip'] >= 4 and len(first['changes']) > 20
    assert not table(state, 'baseline') and not table(state, 'queue') and inventory(root) == before
    app.preview_button.invoke(); window.update()
    assert app.merge_dialog.winfo_exists()
    def widgets(widget):
        for item in widget.winfo_children():
            yield item; yield from widgets(item)
    next_button = next(item for item in widgets(app.merge_dialog) if isinstance(item, ttk.Button) and item.cget('text') == '下一页')
    next_button.invoke(); window.update()
    app.merge_cancel_button.invoke(); window.update()
    assert inventory(root) == before and not table(state, 'baseline') and not table(state, 'queue')
    checks.append('real Tk binds an unbound nonempty directory; readonly paged review classifies uploads/downloads/same/conflicts/skips; cancel changes no business file, baseline or queue')
    collision = edit(collision, '# remote after review\r\n')
    app.preview_button.invoke(); app.merge_confirm_button.invoke()
    wait(lambda: app.phase == 'ATTENTION' and not app.once_button.instate(['disabled']), 'stale remote review')
    second = review(); assert second['fingerprint'] != first['fingerprint']
    assert inventory(root) == before and not table(state, 'queue')
    (root / '合并预检/本地.md').write_bytes(b'# changed locally after preview\r\n')
    before = inventory(root)
    app.preview_button.invoke(); app.merge_confirm_button.invoke()
    wait(lambda: app.phase == 'ATTENTION' and not app.once_button.instate(['disabled']), 'stale local review')
    third = review(); assert third['fingerprint'] != second['fingerprint']
    assert inventory(root) == before and not table(state, 'baseline')
    checks.append('a server edit or local edit invalidates the concrete confirmation fingerprint before any transfer')
    app.preview_button.invoke(); app.merge_confirm_button.invoke()
    wait(lambda: app.phase == 'ATTENTION' and not app.once_button.instate(['disabled']) and app.snapshot['result'].get('status') != 'INITIAL_MERGE_REVIEW_REQUIRED', 'approved merge')
    result = app.snapshot['result']; assert result['status'] == 'OK', result
    assert (root / collision['path']).read_bytes() == b'# remote after review\r\n'
    assert b'# local\r\n' in [path.read_bytes() for path in (root / '合并预检').glob('同名 (conflict-*.md')]
    assert b'\x00local\xff' in [path.read_bytes() for path in (root / '合并预检').glob('同名 (conflict-*.bin')]
    assert (root / binary['path']).read_bytes() == b'\x00remote\xff'
    assert (root / deleted['path']).read_bytes() == fixtures['已删除.md']
    assert request('/notes/' + deleted['id'])['deleted']
    assert request('/notes/' + same['id'])['version'] == same['version']
    assert (root / remote_only['path']).read_bytes() == b'# download\r\n'
    assert inventory(root)['.obsidian/config.json'] == before['.obsidian/config.json']
    assert inventory(root)['合并预检/e\u0301.md'] == before['合并预检/e\u0301.md']
    assert (outside / 'never-read.md').read_bytes() == b'# outside root'
    assert not table(state, 'queue') and any(row[0] == 'initial_merge_complete' for row in table(state, 'setting'))
    assert len(result['conflicts']) >= 3 and any(item['code'] == 'FILE_TOO_LARGE' for item in result['issues'])
    assert any(item['code'] == 'UNSAFE_LINK' for item in result['issues'])
    checks.append('confirmed real merge preserves Markdown and binary variants, keeps local bytes at a server tombstone, maps identical bytes without a new version, transfers valid files and retains invalid/oversize/excluded/junction items')
    expired_base = next(json.loads(row[1]) for row in table(state, 'baseline') if row[0] == '合并清理/已过期.md')
    assert expired_base['deleted'] and not (root / expired_base['path']).exists()
    assert not any(row[0] == expired_base['id'] for row in table(state, 'remote_catalog'))
    checks.append('a real retention-purged tombstone is acknowledged and retired from the local catalog without falsely invalidating the approved initial merge or restoring its file')
    app.close()
    while not app.worker.stopped.wait(.05): window.update()
    window.after_cancel(app.poll_timer); window.destroy(); window = app = None
    # A new profile must never adopt another configuration's already marked root.
    try:
        configure(backend, root, output / 'state-forbidden', 'x' * 43, allow_existing=True)
        raise AssertionError('adopted a bound root')
    except SyncError as error:
        assert error.code == 'DIRECTORY_ALREADY_BOUND'
    (root / 'already-bound-child').mkdir()
    try:
        configure(backend, root / 'already-bound-child', output / 'state-forbidden-child', 'x' * 43, allow_existing=True)
        raise AssertionError('nested a new root inside an existing bound root')
    except SyncError as error:
        assert error.code == 'DIRECTORY_ALREADY_BOUND'
    protected_parent = output / 'protected-parent'
    _, _, bound_child = pair('bound-child', protected_parent / 'child')
    bound_child.close()
    try:
        configure(backend, protected_parent, output / 'state-forbidden-parent', 'x' * 43, allow_existing=True)
        raise AssertionError('adopted a parent containing a bound root')
    except SyncError as error:
        assert error.code == 'DIRECTORY_ALREADY_BOUND'
    selected_root = output / 'root-selected'
    (selected_root / '合并预检').mkdir(parents=True); (selected_root / '未选').mkdir()
    (selected_root / '合并预检/选中.md').write_bytes(b'# selected\r\n')
    (selected_root / '未选/保留.md').write_bytes(b'# excluded\r\n')
    _, _, selected = pair('selected', selected_root, scope={'all': False, 'folders': ['合并预检']})
    selected_before = inventory(selected_root)
    value = selected.cycle(); assert value['status'] == 'INITIAL_MERGE_REVIEW_REQUIRED', value
    result = selected.cycle(initial_confirmation=value['initialMergePreview']['fingerprint'])
    assert result['status'] == 'OK', result
    assert (selected_root / shared['path']).read_bytes() == b'\x00shared\xff'
    assert inventory(selected_root)['未选/保留.md'] == selected_before['未选/保留.md']
    checks.append('multi-folder policy still admits a referenced external attachment, preserves unselected files and refuses adoption of an existing root marker')

    create('合并中断', kind='folder'); create('合并中断/远端.md', '# remote resume\r\n')
    resume_root = output / 'root-resume'; (resume_root / '合并中断').mkdir(parents=True)
    acknowledged = resume_root / '合并中断/先提交.md'; acknowledged.write_bytes(b'# acknowledged before crash\r\n')
    pending = resume_root / '合并中断/本地.md'; pending.write_bytes(b'# commit once\r\n')
    relay = CommitRelay()
    _, resume_state, resumed = pair('resume', resume_root, relay.url, {'all': False, 'folders': ['合并中断']})
    value = resumed.cycle(); assert value['status'] == 'INITIAL_MERGE_REVIEW_REQUIRED', value
    fingerprint = value['initialMergePreview']['fingerprint']; resumed.close(); resumed = None
    code = 'import sys; from pathlib import Path; from privatespace_sync.engine import Engine; e=Engine(Path(sys.argv[1]), stable_seconds=.01, delete_grace=0); e.cycle(initial_confirmation=sys.argv[2]); e.close()'
    with (output / 'crash-child.log').open('w', encoding='utf-8') as log:
        child = subprocess.Popen([sys.executable, '-c', code, str(resume_state), fingerprint], stdout=log, stderr=log)
        assert relay.committed.wait(40), 'real upload did not commit before crash'
        child.kill(); child.wait(10); child = None
    relay.hold = False; relay.release.set()
    assert len(table(resume_state, 'queue')) == 1
    baseline_before = table(resume_state, 'baseline')
    assert len(baseline_before) == 1 and baseline_before[0][0] == '合并中断/先提交.md'
    published = next(item for item in request('/notes?query=' + urllib.parse.quote('合并中断/本地.md'))['items'] if item['path'] == '合并中断/本地.md')
    assert published['version'] == '1'
    first_published = next(item for item in request('/notes?query=' + urllib.parse.quote('合并中断/先提交.md'))['items'] if item['path'] == '合并中断/先提交.md')
    edit(first_published, '# edited remotely during interruption\r\n')
    pending.unlink()
    resumed = Engine(resume_state, stable_seconds=.01, delete_grace=0)
    device = next(item for item in request('/sync-devices') if item['id'] == resumed.config['device'])
    request('/sync-devices/' + device['id'] + '/scope', {'scope': {'all': False, 'folders': ['合并中断', '合并预检']},
        'baseVersion': device['scopeVersion']}, method='PUT')
    value = resumed.cycle(); assert value['status'] == 'INITIAL_MERGE_REVIEW_REQUIRED', value
    assert not pending.exists() and len(table(resume_state, 'queue')) == 1
    assert table(resume_state, 'baseline') == baseline_before
    result = resumed.cycle(initial_confirmation=value['initialMergePreview']['fingerprint'])
    assert result['status'] == 'OK', result
    assert pending.read_bytes() == b'# commit once\r\n' and not table(resume_state, 'queue')
    assert acknowledged.read_bytes() == b'# edited remotely during interruption\r\n'
    assert b'# acknowledged before crash\r\n' in [path.read_bytes() for path in acknowledged.parent.glob('先提交 (conflict-*.md')]
    after = request('/notes/' + published['id'])
    assert after['version'] == '1' and not after['deleted'] and relay.posts == 2
    checks.append('real process kill after the second committed upload preserves the first baseline and pending operation; scope expansion during review changes neither; confirmation preserves both versions of a remotely edited acknowledged file and restores the missing file without server deletion or duplicate publication')
    resumed.close(); resumed = None
    # Fault injection: retained client state is ahead of the actual server, as after a rollback.
    resumed = Engine(resume_state, stable_seconds=.01, delete_grace=0)
    resumed.enqueue(published['path'], after, b'# earlier queued edit\r\n')
    pending.write_bytes(b'# latest local edit\r\n')
    view_row = json.loads(resumed.db.execute("SELECT value FROM setting WHERE key='remote_view'").fetchone()[0])
    view_row['cursor'] = str(int(view_row['cursor']) + 1000000)
    resumed.db.execute("UPDATE setting SET value=? WHERE key='remote_view'", (json.dumps(view_row),))
    resumed.db.execute("UPDATE setting SET value=? WHERE key='cursor'", (view_row['cursor'],)); resumed.db.commit()
    assert resumed.cycle()['code'] == 'SERVER_ROLLBACK_RECONCILIATION_REQUIRED'
    resumed.close(); resumed = None
    before_review = {name: table(resume_state, name) for name in ('baseline', 'queue', 'setting', 'remote_catalog', 'rename_queue', 'local_identity')}
    files_before_review = inventory(resume_root)
    window = tk.Tk(); window.withdraw(); app = SyncApp(window, resume_state)
    wait(lambda: app.snapshot.get('root') is not None, 'reopen for reconciliation preview')
    app.reconcile_button.invoke()
    wait(lambda: app.phase == 'ATTENTION' and app.snapshot['result'].get('reconciliationPreview') is not None, 'readonly reconciliation preview')
    review = app.snapshot['result']['reconciliationPreview']
    assert review['readOnly'] and review['changes'] and len(app.table.get_children()) <= 20
    assert inventory(resume_root) == files_before_review
    assert {name: table(resume_state, name) for name in before_review} == before_review
    assert not app.worker.automatic
    checks.append('real Tk reconciliation preview reads a fresh paginated server inventory while preserving files, SQLite cursor/catalog/baselines/queues/identities and stopping automatic synchronization')
    move = {'targetPath': '合并中断/服务端新名.md', 'baseVersion': after['version']}
    plan = request('/notes/' + after['id'] + '/move-preview', move)
    moved = request('/notes/' + after['id'] + '/move', {**move, 'fingerprint': plan['fingerprint']})
    app.preview_button.invoke(); app.merge_confirm_button.invoke()
    wait(lambda: app.phase == 'ATTENTION' and app.snapshot.get('code') == 'RECONCILIATION_CHANGED', 'stale reconciliation confirmation')
    assert {name: table(resume_state, name) for name in before_review} == before_review
    current_review = app.snapshot['result']['reconciliationPreview']
    assert any(item['path'] == published['path'] and item['action'] == 'uncertain-delete' for item in current_review['changes'])
    app.preview_button.invoke(); app.merge_confirm_button.invoke()
    wait(lambda: app.phase == 'ATTENTION' and app.snapshot['result'].get('status') == 'OK', 'confirmed reconciliation')
    assert pending.read_bytes() == b'# latest local edit\r\n'
    assert (resume_root / moved['path']).read_bytes() == b'# commit once\r\n'
    assert request('/notes/' + published['id'])['path'] == moved['path']
    assert not [item for item in request('/notes?query=' + urllib.parse.quote(published['path']))['items'] if item['path'] == published['path']]
    archived = json.loads(table(resume_state, 'reconciliation_archive')[0][2])['state']
    assert base64.b64decode(json.loads(archived['queue'][0]['request'])['contentBase64']) == b'# earlier queued edit\r\n'
    assert archived['baseline'] and not table(resume_state, 'queue')
    assert not any(row[0] == 'reconciliation_active' for row in table(resume_state, 'setting'))
    checks.append('a real server rejects the injected ahead cursor; stale approval is readonly; fresh Tk confirmation archives original tasks/baselines, restores a usable cursor, downloads the server move and retains ambiguous local bytes without recreating the old server path')
    (output / 'initial-merge.json').write_text(json.dumps({'checks': checks, 'packagedExecutableRoundtrip': False,
        'nativeVisualManualReview': False}, ensure_ascii=False, indent=2), encoding='utf-8')
    print('PASS: initial-merge', flush=True)
finally:
    if child and child.poll() is None: child.kill(); child.wait(10)
    if app:
        app.close()
        while not app.worker.stopped.wait(.05): window.update()
        try: window.after_cancel(app.poll_timer); window.destroy()
        except tk.TclError: pass
    for client in (seeder, selected, resumed):
        if client: client.close()
    if relay: relay.close()
