"""Operate the real frozen GUI against an isolated backend with actual Windows mouse input."""

import ctypes
from ctypes import wintypes
import http.cookiejar
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import tkinter as tk
import urllib.parse
import urllib.request
from PIL import ImageGrab

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from privatespace_sync.desktop import SyncApp
from privatespace_sync.engine import configure

backend = os.environ['NOTES_BACKEND']
origin = 'http://127.0.0.1:' + os.environ['NOTES_FRONTEND_PORT']
output = Path(os.environ['PACKAGED_OUTPUT']).resolve()
bundle = Path(os.environ['M2_DESKTOP_BUNDLE']).resolve()
assert output.is_relative_to(Path(__file__).resolve().parents[2] / 'frontend/test-results')
output.mkdir(parents=True, exist_ok=True)
web = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(path, body=None, method=None):
    headers = {'Origin': origin, 'Content-Type': 'application/json', 'Idempotency-Key': str(__import__('uuid').uuid4())}
    if body is not None or method:
        headers['X-CSRF-TOKEN'] = request('/auth/csrf')['token']
    call = urllib.request.Request(backend + '/api/v1' + path, headers=headers,
        data=json.dumps(body).encode() if body is not None else None, method=method)
    with web.open(call, timeout=20) as response:
        return json.load(response)


def wait(condition, label, seconds=40):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = condition()
        if result:
            return result
        time.sleep(.15)
    raise AssertionError(label)


user = ctypes.WinDLL('user32', use_last_error=True)
callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user.EnumWindows.argtypes = [callback, wintypes.LPARAM]
user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
user.ScreenToClient.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
user.EnumChildWindows.argtypes = [wintypes.HWND, callback, wintypes.LPARAM]
user.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user.WindowFromPoint.argtypes = [wintypes.POINT]
user.WindowFromPoint.restype = wintypes.HWND
user.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
user.SetForegroundWindow.argtypes = [wintypes.HWND]
user.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]


def window(process, title):
    found = []
    @callback
    def visit(hwnd, _):
        pid = wintypes.DWORD(); user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        text = ctypes.create_unicode_buffer(256); user.GetWindowTextW(hwnd, text, len(text))
        if pid.value == process.pid and text.value == title:
            found.append(hwnd)
        return True
    user.EnumWindows(visit, 0)
    return found[0] if found else None


def click(hwnd, point, *, resize=True):
    user.SetWindowPos(hwnd, wintypes.HWND(-1), 80, 40, 876, 749, 0x40 if resize else 0x43)
    user.SetForegroundWindow(hwnd); time.sleep(.15)
    location = wintypes.POINT(*point); user.ClientToScreen(hwnd, ctypes.byref(location))
    bounds = wintypes.RECT(); user.GetWindowRect(hwnd, ctypes.byref(bounds))
    assert bounds.left <= location.x < bounds.right and bounds.top <= location.y < bounds.bottom
    # Tk does not turn externally sent WM_LBUTTON messages into Tcl widget commands.
    # Verify the real hit target before sending physical input, then wait for delivery.
    targets = []
    @callback
    def child(handle, _):
        rectangle = wintypes.RECT(); user.GetWindowRect(handle, ctypes.byref(rectangle))
        if rectangle.left <= location.x < rectangle.right and rectangle.top <= location.y < rectangle.bottom:
            targets.append(((rectangle.right - rectangle.left) * (rectangle.bottom - rectangle.top), handle))
        return True
    user.EnumChildWindows(hwnd, child, 0)
    assert targets, 'No native child widget at the measured product control'
    target = min(targets, key=lambda item: item[0])[1]
    user.SetCursorPos(location.x, location.y); time.sleep(.2)
    assert user.WindowFromPoint(location) == target, 'Another window covers the real control'
    user.mouse_event(0x2, 0, 0, 0, 0); time.sleep(.1)
    user.mouse_event(0x4, 0, 0, 0, 0)
    time.sleep(.4)


def screenshot(hwnd, name):
    user.SetForegroundWindow(hwnd); time.sleep(.2)
    bounds = wintypes.RECT(); user.GetWindowRect(hwnd, ctypes.byref(bounds))
    ImageGrab.grab(bbox=(bounds.left, bounds.top, bounds.right, bounds.bottom)).save(output / name)


request('/auth/initialize' if os.environ.get('PACKAGED_INITIALIZE') == '1' else '/auth/login',
    {'username': 'notes-it', 'password': os.environ['NOTES_PASSWORD'], 'setupToken': os.environ['NOTES_SETUP']})
request('/notes', {'path': '打包M2验收', 'type': 'folder', 'content': ''})
note = request('/notes', {'path': '打包M2验收/往返.md', 'type': 'note', 'content': '# server initial\n'})
for index in range(20):
    request('/notes', {'path': f'打包M2验收/基线-{index:02}.md', 'type': 'note', 'content': '# retained baseline\n'})
roots, states, devices = [], [], []
for name in ('A', 'B'):
    root, state = output / ('root-' + name), output / ('state-' + name)
    code = request('/sync-devices/pairing-code', {'name': '冻结M2-' + name,
        'scope': {'all': False, 'folders': ['打包M2验收']}})['code']
    devices.append(configure(backend, root, state, code)['device'])
    roots.append(root); states.append(state)

# Measure the actual product's Tk controls with the same real paired state, without executing sync.
calibration = tk.Tk(); calibration.geometry('860x710+10000+10000'); app = SyncApp(calibration, states[0])
while not app.snapshot.get('root'):
    calibration.update(); time.sleep(.03)
calibration.update_idletasks()
points = {name: (widget.winfo_rootx() - calibration.winfo_rootx() + widget.winfo_width() // 2,
                 widget.winfo_rooty() - calibration.winfo_rooty() + widget.winfo_height() // 2)
          for name, widget in {'once': app.once_button, 'start': app.start_button, 'pause': app.pause_button,
                               'conflict': app.conflict_button}.items()}
table_point = (app.table.winfo_rootx() - calibration.winfo_rootx() + 80,
               app.table.winfo_rooty() - calibration.winfo_rooty() + 38)
app.close()
while not app.worker.stopped.is_set():
    calibration.update(); time.sleep(.02)
try:
    calibration.after_cancel(app.poll_timer); calibration.destroy()
except tk.TclError:
    pass

processes = []
checks = []
try:
    handles = []
    for state in states:
        process = subprocess.Popen([str(bundle / 'privatespace-sync.exe'), '--state', str(state)], creationflags=subprocess.CREATE_NO_WINDOW)
        processes.append(process)
        handles.append(wait(lambda: window(process, '私有空间 · 同步助手'), 'frozen main window'))
        time.sleep(3)
        click(handles[-1], points['start'])
        root = roots[len(handles) - 1]
        wait(lambda: (root / note['path']).is_file() and (root / note['path']).read_bytes() == b'# server initial\n', 'frozen download')
    duplicate = subprocess.run([str(bundle / 'privatespace-sync.exe'), '--state', str(states[0])], timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
    assert duplicate.returncode == 0
    checks.append('Two real frozen GUI processes download the same selected folder; repeated launch activates the existing state owner')

    local = roots[0] / '打包M2验收/本地新增.txt'
    local.write_bytes(b'uploaded with browser closed\r\n')
    binary = roots[0] / '打包M2验收/附件.bin'
    binary.write_bytes(b'\x00real packaged attachment\xff')
    def uploaded():
        return next((item for item in request('/notes?query=' + urllib.parse.quote(local.name))['items'] if item['path'] == '打包M2验收/本地新增.txt'), None)
    created = wait(uploaded, 'frozen watcher upload')
    wait(lambda: any(item['path'] == '打包M2验收/附件.bin' for item in request('/notes?query=' + urllib.parse.quote('附件.bin'))['items']), 'frozen binary upload')
    click(handles[1], points['once'])
    wait(lambda: (roots[1] / created['path']).is_file() and (roots[1] / created['path']).read_bytes() == local.read_bytes(), 'second frozen device')
    wait(lambda: (roots[1] / '打包M2验收/附件.bin').is_file() and (roots[1] / '打包M2验收/附件.bin').read_bytes() == binary.read_bytes(), 'frozen binary bytes')
    local.rename(local.with_suffix('.md'))
    wait(lambda: request('/notes/' + created['id'])['path'].endswith('本地新增.md'), 'frozen identity preserving rename')
    assert request('/notes/' + created['id'])['id'] == created['id']
    checks.append('With no browser open, the frozen watcher uploads a real new file, another frozen device downloads exact bytes, and TXT-to-MD rename keeps its server ID')

    for hwnd in handles:
        click(hwnd, points['pause'])
    def paused():
        return all((request('/sync-devices/' + device + '/conflicts').get('helperStatus') or {}).get('phase') == 'PAUSED' for device in devices)
    wait(paused, 'frozen paused reports')
    (roots[0] / note['path']).write_bytes(b'# packaged local conflict\n')
    note = request('/notes/' + note['id'], {'path': note['path'], 'type': 'note', 'baseVersion': note['version'], 'content': '# packaged remote conflict\n'}, 'PUT')
    click(handles[0], points['once'])
    wait(lambda: len(request('/sync-devices/' + devices[0] + '/conflicts')['items']) == 1, 'frozen conflict report')
    copies = list((roots[0] / '打包M2验收').glob('往返 (conflict-*.md'))
    assert any(copy.read_bytes() == b'# packaged local conflict\n' for copy in copies)
    assert request('/notes/' + note['id'])['content'] == '# packaged remote conflict\n'
    click(handles[0], table_point); click(handles[0], points['conflict'])
    dialog = wait(lambda: window(processes[0], '处理同步冲突'), 'frozen manual conflict dialog')
    # This row and action were verified against the actual 820x650 dialog capture.
    # The three real variants are server, current local and the preserved conflict copy.
    click(dialog, (150, 168), resize=False)
    screenshot(dialog, 'packaged-conflict.png')
    rectangle = wintypes.RECT(); user.GetClientRect(dialog, ctypes.byref(rectangle))
    click(dialog, (rectangle.right - 55, rectangle.bottom - 36), resize=False)
    wait(lambda: request('/notes/' + note['id'])['content'] == '# packaged local conflict\n', 'frozen explicit conflict choice')
    wait(lambda: not request('/sync-devices/' + devices[0] + '/conflicts')['items'], 'frozen conflict resolution acknowledged')
    assert any(item['resolution'] == 'copy' for item in request('/sync-devices/' + devices[0] + '/conflicts?state=resolved')['items'])
    assert any(copy.read_bytes() == b'# packaged local conflict\n' for copy in copies)
    screenshot(handles[1], 'packaged-paused.png')
    checks.append('The frozen app preserves both versions, opens the real two-column conflict dialog, explicitly adopts its local conflict copy through the conditional API, then reports the completed choice without removing the original copy')

    # Leave a second actual conflict pending to verify restart preserves it.
    (roots[0] / note['path']).write_bytes(b'# survives frozen restart\n')
    note = request('/notes/' + note['id'])
    note = request('/notes/' + note['id'], {'path': note['path'], 'type': 'note', 'baseVersion': note['version'], 'content': '# second remote conflict\n'}, 'PUT')
    click(handles[0], points['once'])
    wait(lambda: request('/sync-devices/' + devices[0] + '/conflicts')['items'], 'second frozen conflict')

    # Normal window shutdown must release SQLite and state ownership before restart.
    for process, hwnd in zip(processes, handles):
        user.PostMessageW(hwnd, 0x10, 0, 0)
        assert process.wait(25) == 0
    processes.clear()
    restarted = subprocess.Popen([str(bundle / 'privatespace-sync.exe'), '--state', str(states[0])], creationflags=subprocess.CREATE_NO_WINDOW)
    processes.append(restarted)
    hwnd = wait(lambda: window(restarted, '私有空间 · 同步助手'), 'frozen restart')
    wait(lambda: (request('/sync-devices/' + devices[0] + '/conflicts').get('helperStatus') or {}).get('phase') == 'PAUSED', 'restart remains paused')
    assert request('/sync-devices/' + devices[0] + '/conflicts')['items']
    user.PostMessageW(hwnd, 0x10, 0, 0); assert restarted.wait(25) == 0
    checks.append('Normal frozen shutdown and restart preserve the real conflict and SQLite state; restart remains paused')
    (output / 'packaged-m2.json').write_text(json.dumps({'checks': checks, 'realFrozenGui': True,
        'manualResolutionSubmissionInFrozenGui': True, 'cleanWindowsMachine': False}, ensure_ascii=False, indent=2), encoding='utf-8')
    print('PASS: packaged-m2', flush=True)
except Exception:
    for index, process in enumerate(processes):
        hwnd = window(process, '私有空间 · 同步助手')
        if hwnd: screenshot(hwnd, f'failure-window-{index}.png')
    raise
finally:
    for process in processes:
        if process.poll() is None:
            hwnd = window(process, '私有空间 · 同步助手')
            if hwnd: user.PostMessageW(hwnd, 0x10, 0, 0)
            try: process.wait(25)
            except subprocess.TimeoutExpired: process.kill(); process.wait(10)
