"""Real Tk widgets, worker thread, Windows files/DPAPI and product HTTP. No substitute service."""

import http.cookiejar
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
import tkinter as tk
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from privatespace_sync.desktop import SyncApp
from privatespace_sync.transport import SyncError
from privatespace_sync.state_lock import StateLock


backend = os.environ['NOTES_BACKEND']
origin = 'http://127.0.0.1:' + os.environ['NOTES_FRONTEND_PORT']
settings = json.loads(sys.stdin.readline())
output = Path(settings['output'])
root_path = output / 'desktop-vault'
state = output / 'desktop-state'
root_path.mkdir(parents=True, exist_ok=True)
web = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(path, body=None, method=None):
    headers = {'Origin': origin, 'Content-Type': 'application/json', 'Idempotency-Key': str(uuid.uuid4())}
    if body is not None or method:
        headers['X-CSRF-TOKEN'] = request('/auth/csrf')['token']
    call = urllib.request.Request(backend + '/api/v1' + path, headers=headers,
                                  data=json.dumps(body).encode() if body is not None else None, method=method)
    with web.open(call, timeout=15) as response:
        return json.load(response)


def catalog():
    items = []
    cursor = ''
    while cursor is not None:
        page = request('/notes?cursor=' + cursor)
        items += page['items']; cursor = page['nextCursor']
    return items


request('/auth/login', {'username': 'notes-it', 'password': os.environ['NOTES_PASSWORD']})
fixture = '# M2 助手真实往返\n\n中文内容与图片附件目录保持普通文件。\n'
note = request('/notes', {'path': 'M2助手验收.md', 'type': 'note', 'content': fixture})
window = tk.Tk()
window.withdraw()
app = SyncApp(window, state)


def wait(predicate, label, seconds=100):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        window.update()
        if predicate():
            return
        time.sleep(.05)
    raise AssertionError(label + ': phase=' + app.phase + ', code=' + str(app.snapshot.get('code')))


checks = []
try:
    wait(lambda: app.phase == 'UNPAIRED' and not app.pair_button.instate(['disabled']), 'unpaired widgets')
    app.url.set(backend); app.directory.set(str(root_path)); app.code.set(settings.pop('code'))
    app.pair_button.invoke()
    assert app.code.get() == ''
    wait(lambda: app.snapshot.get('root') is not None, 'real pairing')
    assert (state / 'device.dpapi').is_file()
    config = json.loads((state / 'config.json').read_text())
    device = config['device']
    assert any(item['id'] == device for item in request('/sync-devices'))
    checks.append('real Tk pairing writes DPAPI credential and MySQL device record')
    try:
        StateLock(state)
        raise AssertionError('second state writer acquired lock')
    except SyncError as error:
        assert error.code == 'STATE_IN_USE'
    app.once_button.invoke()
    wait(lambda: app.phase in ('READY', 'ATTENTION', 'ERROR'), 'first real download')
    assert app.phase == 'READY', app.status.get()
    assert (root_path / note['path']).read_bytes() == fixture.encode()
    checks.append('Tk manual sync downloads actual object bytes')
    app.start_button.invoke()
    wait(lambda: app.phase == 'WATCHING', 'automatic watcher starts')
    local = root_path / 'M2本地新增.md'
    local.write_text('# 本地新增\n', encoding='utf-8')
    wait(lambda: app.phase == 'WATCHING' and any(item['path'] == local.name for item in catalog()), 'native watcher uploads new file')
    uploaded = next(item for item in catalog() if item['path'] == local.name)
    assert request('/notes/' + uploaded['id'])['content'].encode('utf-8') == local.read_bytes()
    checks.append('native directory watcher uploads while the browser product page is closed')
    app.pause_button.invoke()
    wait(lambda: app.phase == 'PAUSED' and not app.worker.automatic, 'safe pause')
    paused = root_path / 'M2暂停后手动.md'
    paused.write_text('# 暂停后手动同步\n', encoding='utf-8')
    until = time.monotonic() + 2
    while time.monotonic() < until:
        window.update(); time.sleep(.05)
    assert not any(item['path'] == paused.name for item in catalog())
    app.once_button.invoke()
    wait(lambda: app.phase == 'READY', 'manual sync while paused')
    assert any(item['path'] == paused.name for item in catalog())
    checks.append('pause prevents background publication; manual sync uses real backend')
    app.close()
    while not app.worker.stopped.wait(.05):
        window.update()
    window.update()
    window = tk.Tk(); window.withdraw()
    app = SyncApp(window, state)
    wait(lambda: app.snapshot.get('root') is not None, 'restart restores persisted configuration')
    assert app.phase == 'PAUSED'
    assert app.directory.get() == str(root_path.resolve())
    app.start_button.invoke()
    wait(lambda: app.phase == 'WATCHING', 'restart watcher')
    request('/sync-devices/' + device, method='DELETE')
    (root_path / 'M2撤销后不得上传.md').write_text('# 不得上传\n', encoding='utf-8')
    wait(lambda: app.phase == 'ATTENTION' and app.snapshot.get('code') == 'DEVICE_UNAUTHORIZED', 'revocation reaches real worker')
    assert not any(item['path'] == 'M2撤销后不得上传.md' for item in catalog())
    checks.append('restart reopens SQLite and DPAPI; revoked identity cannot publish a new file')
    app.close()
    while not app.worker.stopped.wait(.05):
        window.update()
    with sqlite3.connect(state / 'sync.sqlite') as database:
        assert database.execute('SELECT COUNT(*) FROM baseline').fetchone()[0] > 0
        # The new scope handshake rejects revoked devices before scanning new local content.
        assert database.execute('SELECT COUNT(*) FROM queue').fetchone()[0] == 0
    assert (root_path / 'M2撤销后不得上传.md').read_text(encoding='utf-8') == '# 不得上传\n'
    report = {'checks': checks, 'device': device, 'phase': app.phase,
              'nativeVisualManualReview': False, 'packagedExecutableRoundtrip': False}
    (output / 'desktop.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'device': device, 'checks': len(checks)}), flush=True)
finally:
    app.close()
    app.worker.thread.join(timeout=40)
    try:
        window.destroy()
    except tk.TclError:
        pass
