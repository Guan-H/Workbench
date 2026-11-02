"""Real Tk configuration switching, isolated SQLite queues, DPAPI and HTTP; no mock responses."""

import json
import os
from pathlib import Path
import sqlite3
import time
import tkinter as tk
import urllib.parse

from privatespace_sync.desktop import SyncApp
from privatespace_sync.profiles import Profiles
from privatespace_sync.state_lock import StateLock


def check_profiles(request, backend, output: Path):
    output.mkdir(parents=True, exist_ok=True)
    # Reuse the M0 fault relay: it forwards only actual backend bytes, and closing it causes real connection refusal.
    os.environ.setdefault('M0_SYNC_OUTPUT', str(output / 'network-fault'))
    from check_sync import Relay

    relay = Relay()
    port = relay.port
    root_a = output / 'original-vault'; root_a.mkdir()
    root_b = output / 'new-vault'; root_b.mkdir()
    state = output / 'original-state'
    request('/notes', {'path': '配置切换', 'type': 'folder', 'content': ''})
    note = request('/notes', {'path': '配置切换/已有笔记.md', 'type': 'note', 'content': '# 保留\n'})
    window = tk.Tk(); window.withdraw()
    app = SyncApp(window, state)
    checks = []

    def wait(predicate, label):
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            window.update()
            if predicate():
                return
            time.sleep(.04)
        raise AssertionError(label + ': ' + app.phase + '/' + str(app.snapshot.get('code')))

    def stop():
        app.close()
        while not app.worker.stopped.wait(.05):
            window.update()
        try:
            window.after_cancel(app.poll_timer)
            window.destroy()
        except tk.TclError:
            pass

    def once():
        app.once_button.invoke()
        wait(lambda: app.phase in ('READY', 'ATTENTION', 'ERROR') and not app.once_button.instate(['disabled']), 'manual cycle')

    def queued():
        with sqlite3.connect(state / 'sync.sqlite') as database:
            return database.execute('SELECT COUNT(*) FROM queue').fetchone()[0]

    def switch(identity):
        app.configure_button.invoke()
        app.profile_table.selection_set(identity)
        window.update()
        app.switch_profile_button.invoke()
        wait(lambda: not app.reconfiguring, 'switch configuration')

    try:
        wait(lambda: app.phase == 'UNPAIRED' and not app.pair_button.instate(['disabled']), 'initial configuration')
        app.url.set('http://127.0.0.1:' + str(port)); app.directory.set(str(root_a))
        app.code.set(request('/sync-devices/pairing-code', {'name': '配置切换原设备'})['code'])
        app.pair_button.invoke()
        wait(lambda: app.snapshot.get('root') is not None, 'pair original identity')
        once(); assert app.phase == 'READY', app.status.get()
        original_credential = (state / 'device.dpapi').read_bytes()
        assert (root_a / note['path']).read_bytes() == '# 保留\n'.encode()
        relay.close(); relay = None
        pending_path = '配置切换/原配置离线待上传.md'
        pending = root_a / pending_path; pending.write_bytes(b'# original queue\n')
        once()
        assert app.snapshot['code'] == 'NETWORK_UNAVAILABLE' and queued() == 1
        app.configure_button.invoke()
        app.profile_name.set(' '); app.create_profile_button.invoke()
        assert app.configuration_dialog.winfo_exists() and app.profile_problem.get()
        app.profile_name.set('新服务器或目录'); app.create_profile_button.invoke()
        wait(lambda: not app.reconfiguring and app.phase == 'UNPAIRED', 'create independent configuration')
        second_id = app.snapshot['activeProfile']
        second_state = Path(app.snapshot['state'])
        assert second_state != state and queued() == 1
        assert app.directory.get() == '' and not app.url_entry.instate(['disabled'])
        checks.append('real offline capture survives profile creation; fields unlock for a separate pairing')

        app.url.set(backend)
        pairing = request('/sync-devices/pairing-code', {'name': '配置切换新设备'})['code']
        app.directory.set(str(root_a)); app.code.set(pairing); app.pair_button.invoke()
        wait(lambda: app.phase == 'ERROR' and not app.pair_button.instate(['disabled']), 'reject overlapping old root')
        assert app.snapshot['code'] == 'PROFILE_ROOT_OVERLAP' and queued() == 1
        app.directory.set(str(root_b)); app.code.set('x' * 43); app.pair_button.invoke()
        wait(lambda: app.phase == 'ERROR' and app.snapshot['code'] == 'INVALID_PAIRING', 'invalid new pairing')
        assert (state / 'device.dpapi').read_bytes() == original_credential and queued() == 1
        app.code.set(pairing); app.pair_button.invoke()
        wait(lambda: app.snapshot.get('root') == str(root_b.resolve()), 'new independent pairing')
        assert (second_state / 'device.dpapi').read_bytes() != original_credential
        once(); assert app.phase == 'READY', app.status.get()
        assert queued() == 1 and pending.read_bytes() == b'# original queue\n'
        assert not [item for item in request('/notes?query=' + urllib.parse.quote('原配置离线待上传'))['items'] if item['path'] == pending_path]
        checks.append('new real pairing failure preserves original bytes and queue; overlapping roots are rejected; old upload is not replayed')

        stop(); window = tk.Tk(); window.withdraw(); app = SyncApp(window, state)
        wait(lambda: app.snapshot.get('root') == str(root_b.resolve()), 'restart remembers active profile')
        assert app.phase == 'PAUSED' and app.snapshot['activeProfile'] == second_id
        app.start_button.invoke(); wait(lambda: app.phase == 'WATCHING', 'new profile watcher')
        with StateLock(state):
            switch('default')
            assert app.phase == 'ERROR' and app.snapshot['code'] == 'STATE_IN_USE'
            assert app.snapshot['activeProfile'] == second_id and not app.worker.automatic
        checks.append('restart restores active profile paused; locked target fails safely and stops the watcher')
        switch('default')
        assert app.phase == 'PAUSED' and app.url.get() == 'http://127.0.0.1:' + str(port)
        assert (state / 'device.dpapi').read_bytes() == original_credential and queued() == 1
        relay = Relay(port)
        once(); assert app.phase == 'READY', app.status.get()
        uploaded = [item for item in request('/notes?query=' + urllib.parse.quote('原配置离线待上传'))['items'] if item['path'] == pending_path]
        assert len(uploaded) == 1 and queued() == 0
        assert request('/notes/' + uploaded[0]['id'])['content'].encode() == pending.read_bytes()
        checks.append('switch back restores original server and credential; pending queue uploads through the restored real transport')

        stop()
        profiles = Profiles(state)
        try:
            for index in range(19):
                profiles.create('分页配置-' + str(index))
            profiles.activate('default')
        finally:
            profiles.close()
        window = tk.Tk(); window.withdraw(); app = SyncApp(window, state)
        wait(lambda: app.snapshot.get('root') is not None, 'restart with 21 persisted profiles')
        app.configure_button.invoke()
        assert len(app.profile_table.get_children()) == 20
        buttons = app.configuration_dialog.winfo_children()[0].winfo_children()[-1].winfo_children()
        next(button for button in buttons if str(button.cget('text')) == '下一页').invoke()
        window.update()
        assert len(app.profile_table.get_children()) == 1
        app.configuration_dialog.destroy()
        checks.append('21 real saved profiles paginate 20/1 without deleting or exposing device tokens')
        report = {'checks': checks, 'separateBackendInstances': False,
                  'transport': 'Two real HTTP addresses to one Spring/MySQL instance; relay shutdown injects connection refusal only',
                  'nativeVisualManualReview': False, 'packagedExecutableRoundtrip': False}
        (output / 'profiles.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    finally:
        stop()
        if relay:
            relay.close()
