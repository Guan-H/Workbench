"""Real server-owned folder selection, attachment dependencies and safe scope changes."""

import base64
import hashlib
import http.cookiejar
import json
import logging
import os
from pathlib import Path
import sys
import time
import tkinter as tk
import urllib.error
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from privatespace_sync.desktop import SyncApp
from privatespace_sync.engine import Engine, configure
from privatespace_sync.credentials import protect
from privatespace_sync.transport import Remote, SyncError
from check_profiles import check_profiles

logging.basicConfig(level=logging.DEBUG)

backend = os.environ['NOTES_BACKEND']
origin = 'http://127.0.0.1:' + os.environ['NOTES_FRONTEND_PORT']
settings = json.loads(sys.stdin.readline())
output = Path(settings['output']); output.mkdir(parents=True, exist_ok=True)
root_path = output / 'selected-vault'; root_path.mkdir()
state = output / 'selected-state'
web = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(path, body=None, method=None):
    headers = {'Origin': origin, 'Content-Type': 'application/json', 'Idempotency-Key': str(uuid.uuid4())}
    if body is not None or method:
        headers['X-CSRF-TOKEN'] = request('/auth/csrf')['token']
    call = urllib.request.Request(backend + '/api/v1' + path, headers=headers,
                                  data=json.dumps(body).encode() if body is not None else None, method=method)
    with web.open(call, timeout=20) as response:
        return json.load(response)


request('/auth/login', {'username': 'notes-it', 'password': os.environ['NOTES_PASSWORD']})
fixture = '# 选择范围\n\n![共享](../共享附件/图.PNG)\n\n[外部笔记](../选择工作相似/不应下载.md)\n'
note = request('/notes', {'path': '选择工作/笔记.md', 'type': 'note', 'content': fixture})
personal = request('/notes', {'path': '选择个人/私有.md', 'type': 'note', 'content': '# 个人\n'})
restore_note = request('/notes', {'path': '选择个人/重新纳入.md', 'type': 'note', 'content': '# 重新纳入不传播删除\n'})
outside = request('/notes', {'path': '选择工作相似/不应下载.md', 'type': 'note', 'content': '# 不选\n'})
for path in ('选择工作/空目录', '选择工作/空目录/深层', '选择工作/纯空目录', '选择工作/纯空目录/下一层', '选择个人/空目录', '选择工作相似/不选空目录'):
    request('/notes', {'path': path, 'type': 'folder', 'content': ''})
global_pair = request('/sync-devices/pairing-code', {'name': '附件准备身份'})
global_device = Remote(backend).request('/pair', body={'code': global_pair['code']})
global_remote = Remote(backend, global_device['token'])
image = (Path(__file__).parent / 'fixtures' / 'visual-check.png').read_bytes()
shared = global_remote.request('/files', body={'id': None, 'path': '共享附件/图.png', 'baseVersion': '0', 'deleted': False,
                                'sha256': hashlib.sha256(image).hexdigest(), 'contentBase64': base64.b64encode(image).decode()}, operation=str(uuid.uuid4()))
global_remote.request('/files', body={'id': None, 'path': '共享附件/无关.png', 'baseVersion': '0', 'deleted': False,
                       'sha256': hashlib.sha256(image).hexdigest(), 'contentBase64': base64.b64encode(image).decode()}, operation=str(uuid.uuid4()))
window = tk.Tk(); window.withdraw()
app = SyncApp(window, state)


def wait(predicate, label):
    deadline = time.monotonic() + 70
    while time.monotonic() < deadline:
        window.update()
        if predicate():
            return
        time.sleep(.05)
    raise AssertionError(label + ': ' + app.phase + '/' + str(app.snapshot.get('code')))


def stop_app():
    app.close()
    while not app.worker.stopped.wait(.05):
        window.update()
    try:
        window.after_cancel(app.poll_timer)
        window.destroy()
    except tk.TclError:
        pass


engine = None
checks = []
try:
    wait(lambda: app.phase == 'UNPAIRED' and not app.pair_button.instate(['disabled']), 'open selection window')
    app.url.set(backend); app.directory.set(str(root_path)); app.code.set(settings.pop('code'))
    app.pair_button.invoke()
    wait(lambda: app.snapshot.get('root') is not None, 'pair selection')
    app.once_button.invoke()
    wait(lambda: app.phase in ('READY', 'ATTENTION', 'ERROR'), 'scoped Tk manual sync')
    assert app.phase == 'READY', app.status.get()
    assert (root_path / note['path']).read_bytes() == fixture.encode()
    assert (root_path / personal['path']).exists()
    assert (root_path / shared['path']).read_bytes() == image
    assert not (root_path / outside['path']).exists()
    assert not (root_path / '共享附件/无关.png').exists()
    assert '选择工作' in app.scope_label.get() and '选择个人' in app.scope_label.get()
    assert (root_path / '选择工作/空目录/深层').is_dir()
    assert (root_path / '选择个人/空目录').is_dir()
    assert not (root_path / '选择工作相似').exists()
    app.start_button.invoke()
    wait(lambda: app.phase == 'WATCHING', 'watch downloaded directory structure')
    created_path = '选择工作/空目录/深层/本地新建.md'
    (root_path / created_path).write_bytes(b'# created inside downloaded directory\n')
    def created_on_server():
        return any(item['path'] == created_path for item in global_remote.request('/snapshot')['items'])
    wait(lambda: app.phase == 'WATCHING' and created_on_server(), 'native watcher uploads inside materialized empty directory')
    app.pause_button.invoke()
    wait(lambda: app.phase == 'PAUSED' and not app.worker.automatic, 'pause directory watcher')
    checks.append('selected empty subdirectories materialize; native watcher publishes a file created inside them; unselected directories stay absent')
    (root_path / '共享附件/本地新图.png').write_bytes(image)
    (root_path / '选择工作/本地新引用.md').write_text('# 新引用\n\n![新图](../共享附件/本地新图.png)\n', encoding='utf-8', newline='')
    app.once_button.invoke()
    wait(lambda: app.phase in ('READY', 'ATTENTION', 'ERROR') and not app.once_button.instate(['disabled']), 'follow-up reference scan')
    assert app.phase == 'READY', app.status.get()
    new_attachment = [item for item in request('/notes?query=' + urllib.parse.quote('共享附件/本地新图.png'))['items']
                      if item['path'] == '共享附件/本地新图.png']
    assert len(new_attachment) == 1 and new_attachment[0]['sha256'] == hashlib.sha256(image).hexdigest()
    stop_app()
    checks.append('Tk pairing preserves selected subtrees and external relative attachment; excludes sibling-prefix and linked notes')
    checks.append('Tk manual sync publishes a new local note then rescans and uploads its new out-of-folder image')
    engine = Engine(state, stable_seconds=.02, delete_grace=0)
    device_id = engine.config['device']
    remote = Remote(backend, protect((state / 'device.dpapi').read_bytes(), decrypt=True).decode('ascii'))
    remote.scope_version = engine.remote.scope_version
    try:
        remote.request('/files/' + outside['id'] + '?version=' + outside['version'], binary=True)
        raise AssertionError('out-of-scope read accepted')
    except SyncError as error:
        assert error.code == 'OUTSIDE_SYNC_SCOPE'
    try:
        remote.request('/files', body={'id': shared['id'], 'path': shared['path'], 'baseVersion': shared['version'], 'deleted': True}, operation=str(uuid.uuid4()))
        raise AssertionError('shared attachment delete accepted')
    except SyncError as error:
        assert error.code == 'OUTSIDE_SYNC_SCOPE'
    (root_path / shared['path']).unlink()
    assert engine.cycle()['status'] == 'OK'
    assert (root_path / shared['path']).read_bytes() == image
    assert not request('/notes/' + shared['id'])['deleted']
    checks.append('server rejects scope escape and shared deletion; missing shared local copy redownloads')
    (root_path / shared['path']).write_bytes(image + b'edited')
    assert engine.cycle()['status'] == 'OK'
    assert request('/notes/' + shared['id'])['sha256'] == hashlib.sha256(image + b'edited').hexdigest()
    (root_path / '选择工作/本地新增.md').write_bytes(b'# selected upload\n')
    (root_path / '选择工作相似').mkdir(exist_ok=True)
    (root_path / '选择工作相似/本地不上传.md').write_bytes(b'# never publish\n')
    assert engine.cycle()['status'] == 'OK'
    assert not any(row['path'].startswith('选择工作相似/') for row in engine.db.execute('SELECT path FROM queue'))
    checks.append('selected new file and shared attachment edit upload; out-of-scope local file is never queued')
    current = next(item for item in request('/sync-devices') if item['id'] == device_id)
    engine.enqueue(personal['path'], personal, b'# held local upload\n')
    (root_path / personal['path']).write_bytes(b'# held local upload\n')
    updated = request('/sync-devices/' + device_id + '/scope', {'scope': {'all': False, 'folders': ['选择工作']}, 'baseVersion': current['scopeVersion']}, method='PUT')
    try:
        remote.request('/files/' + note['id'] + '?version=' + note['version'], binary=True)
        raise AssertionError('stale scope version accepted')
    except SyncError as error:
        assert error.code == 'SYNC_SCOPE_CHANGED'
    result = engine.cycle()
    assert result['status'] == 'OK' and result['heldQueued'] == 1, result
    assert request('/notes/' + personal['id'])['content'] == '# 个人\n'
    assert (root_path / personal['path']).read_bytes() == b'# held local upload\n'
    engine.close(); engine = Engine(state, stable_seconds=.02, delete_grace=0)
    assert engine.status()['heldQueued'] == 1
    checks.append('scope revision rejects in-flight stale requests; excluded pending upload and bytes survive restart without publication')
    # An old deletion baseline must not return when a directory is reselected.
    (root_path / restore_note['path']).unlink()
    latest = request('/sync-devices/' + device_id + '/scope', {'scope': {'all': False, 'folders': ['选择工作', '选择个人']}, 'baseVersion': updated['scopeVersion']}, method='PUT')
    assert engine.cycle()['status'] == 'OK'
    assert (root_path / restore_note['path']).read_bytes() == '# 重新纳入不传播删除\n'.encode()
    assert not request('/notes/' + restore_note['id'])['deleted']
    assert request('/notes/' + personal['id'])['content'] == '# held local upload\n'
    assert engine.status()['heldQueued'] == 0
    try:
        request('/sync-devices/' + device_id + '/scope', {'scope': {'all': True, 'folders': []}, 'baseVersion': updated['scopeVersion']}, method='PUT')
        raise AssertionError('stale web scope update accepted')
    except urllib.error.HTTPError as error:
        assert error.code == 409
    # Removing a reference retains its local dependency and never admits unrelated files.
    note = request('/notes/' + note['id'], {'path': note['path'], 'type': 'note', 'content': '# 不再引用\n', 'baseVersion': note['version']}, method='PUT')
    assert engine.cycle()['status'] == 'OK'
    assert (root_path / shared['path']).exists()
    assert not engine.selection.includes(shared['path'])
    assert not (root_path / '共享附件/无关.png').exists()
    engine.close(); engine = None
    checks.append('reselecting downloads missing files without inferred deletion; removing reference preserves excluded shared copy; stale web update rejected')
    empty_root = output / 'empty-roots-vault'
    empty_state = output / 'empty-roots-state'
    empty_code = request('/sync-devices/pairing-code', {'name': '纯空目录验收', 'scope': {'all': False, 'folders': ['选择工作/纯空目录', '选择个人/空目录']}})['code']
    configure(backend, empty_root, empty_state, empty_code)
    engine = Engine(empty_state, stable_seconds=.02, delete_grace=0)
    collision = empty_root / '选择工作'; collision.write_bytes(b'keep local bytes')
    result = engine.cycle()
    assert any(issue['code'] == 'DIRECTORY_PATH_CONFLICT' for issue in result['issues']), result
    assert collision.read_bytes() == b'keep local bytes'
    assert result['status'] == 'INITIAL_MERGE_REVIEW_REQUIRED', result
    assert not (empty_root / '选择个人/空目录').exists(), 'initial preview must not create business directories'
    result = engine.cycle(initial_confirmation=result['initialMergePreview']['fingerprint'])
    assert any(issue['code'] == 'DIRECTORY_PATH_CONFLICT' for issue in result['issues']), result
    assert (empty_root / '选择个人/空目录').is_dir()
    collision.unlink()
    result = engine.cycle()
    assert result['status'] == 'OK' and not result['issues'], result
    assert (empty_root / '选择工作/纯空目录/下一层').is_dir()
    assert not (empty_root / '选择工作/空目录').exists()
    assert not (empty_root / '选择个人/私有.md').exists()
    checks.append('two selected empty roots retain full ancestor paths and descendants; a conflicting local file is preserved without blocking the other root')
    empty_new_path = '选择工作/纯空目录/下一层/新文件.md'
    (empty_root / empty_new_path).write_bytes(b'# safe directory baseline\n')
    assert engine.cycle()['status'] == 'OK'
    server_file = next(item for item in global_remote.request('/snapshot')['items'] if item['path'] == empty_new_path)
    moved = output / 'missing-parent-preserved-copy'
    original = empty_root / '选择工作/纯空目录'
    original.rename(moved)
    result = engine.cycle()
    assert any(issue['code'] == 'PARENT_DIRECTORY_UNAVAILABLE' for issue in result['issues']), result
    assert not original.exists()
    assert not request('/notes/' + server_file['id'])['deleted']
    moved.rename(original)
    result = engine.cycle()
    assert result['status'] == 'OK' and not result['issues'], result
    engine.close(); engine = None
    checks.append('a missing parent of baseline files is not silently recreated and cannot trigger remote deletion; restoration resumes reconciliation')
    check_profiles(request, backend, output / 'profiles')
    (output / 'scope.json').write_text(json.dumps({'checks': checks, 'device': device_id}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'device': device_id, 'checks': len(checks)}))
finally:
    if engine:
        engine.close()
    if not app.worker.stopped.is_set():
        stop_app()
