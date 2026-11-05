"""Real remote rename choices, Tk actions, stale protection and commit/ack recovery."""

import json
import subprocess
import sys
from privatespace_sync.engine import Engine
from privatespace_sync.conflicts import preview, resolve
from privatespace_sync.transport import SyncError


def check_rename_choices(app, window, wait, request, pair, create, edit, Relay, output):
    folder = '改名选择验收'
    create(folder, kind='folder')
    files = [create(f'{folder}/{index}.md', '# base\n') for index in range(14)]
    relay = Relay('/api/v1/sync/conflict-files', 1); relay.hold = False
    root, state, engine = pair('rename-choices', url=relay.url, scope={'all': False, 'folders': [folder]})
    child = None
    def moved(file, target):
        body = {'targetPath': target, 'baseVersion': file['version']}
        plan = request('/notes/' + file['id'] + '/move-preview', body)
        return request('/notes/' + file['id'] + '/move', {**body, 'fingerprint': plan['fingerprint']})
    try:
        assert engine.cycle()['status'] == 'OK'
        source = files[0]['path']; target = folder + '/local-choice.md'
        (root / source).write_bytes(b'# user local choice\n')
        file = moved(files[0], target)
        assert engine.cycle()['isolatedRenameIssues']
        view = preview(engine, target)
        resolve(engine, target, view['fingerprint'], 'local')
        assert not (root / source).exists() and (root / target).read_bytes() == b'# user local choice\n'
        actual = request('/notes/' + file['id'])
        assert actual['id'] == file['id'] and actual['version'] == '3' and actual['content'] == '# user local choice\n'
        assert any(path.read_bytes() == b'# user local choice\n' for path in (state / 'recycle').glob('*.bin'))

        source = files[1]['path']; target = folder + '/server-choice.md'
        (root / source).write_bytes(b'# preserve before server choice\n')
        file = moved(files[1], target); engine.cycle()
        view = preview(engine, target)
        file = edit(file, '# third server edit\n')
        try:
            resolve(engine, target, view['fingerprint'], 'server')
            raise AssertionError('stale server choice accepted')
        except SyncError as error:
            assert error.code == 'CONFLICT_CHANGED'
        assert (root / source).read_bytes() == b'# preserve before server choice\n'
        view = preview(engine, target); resolve(engine, target, view['fingerprint'], 'server')
        assert not (root / source).exists() and (root / target).read_bytes() == b'# third server edit\n'
        assert request('/notes/' + file['id'])['version'] == file['version']
        assert any(path.read_bytes() == b'# preserve before server choice\n' for path in (state / 'recycle').glob('*.bin'))

        source = files[2]['path']; target = folder + '/merged-choice.md'
        (root / source).write_bytes(b'# merge input\n')
        file = moved(files[2], target); engine.cycle()
        engine.close(); engine = None
        # Switch the actual app to this independent test configuration through its normal API.
        from privatespace_sync.desktop import SyncApp
        import tkinter as tk
        gui = tk.Tk(); gui.withdraw(); choices_app = SyncApp(gui, state)
        import time
        def await_choice(predicate):
            deadline = time.monotonic() + 35
            while time.monotonic() < deadline:
                gui.update()
                if predicate(): return
                time.sleep(.03)
            raise AssertionError('rename choice UI timed out')
        try:
            await_choice(lambda: choices_app.snapshot.get('root') is not None)
            choices_app.once_button.invoke()
            await_choice(lambda: choices_app.phase == 'READY_ATTENTION')
            item = next(item for item in choices_app.table.get_children() if choices_app.table.item(item, 'values')[0] == target)
            choices_app.table.selection_set(item); gui.update()
            assert not choices_app.conflict_button.instate(['disabled'])
            choices_app.conflict_button.invoke()
            await_choice(lambda: choices_app.conflict_dialog and choices_app.conflict_dialog.window.winfo_exists())
            dialog = choices_app.conflict_dialog
            assert dialog.review['rename']['intent']['source'] == source
            index = next(index for index, item in enumerate(dialog.review['variants']) if item['id'] == 'local')
            dialog.table.selection_set(str(index)); gui.update(); dialog.manual.invoke(); gui.update()
            dialog.editor.delete('1.0', 'end'); dialog.editor.insert('1.0', '# explicit renamed merge\n')
            dialog.save_merge.invoke()
            await_choice(lambda: choices_app.snapshot['result'].get('status') == 'CONFLICT_RESOLVED')
            assert request('/notes/' + file['id'])['content'] == '# explicit renamed merge\n'
            assert not (root / source).exists() and (root / target).read_bytes() == b'# explicit renamed merge\n'
        finally:
            choices_app.close()
            while not choices_app.worker.stopped.wait(.03): gui.update()
            try: gui.after_cancel(choices_app.poll_timer); gui.destroy()
            except tk.TclError: pass
        engine = Engine(state, stable_seconds=.01, delete_grace=0)

        source = files[3]['path']; target = folder + '/interrupted-choice.md'
        (root / source).write_bytes(b'# durable renamed local choice\n')
        file = moved(files[3], target); engine.cycle(); view = preview(engine, target)
        engine.close(); engine = None
        relay.posts = 0; relay.hold = True
        code = 'import sys; from pathlib import Path; from privatespace_sync.engine import Engine; from privatespace_sync.conflicts import resolve; e=Engine(Path(sys.argv[1])); resolve(e,sys.argv[2],sys.argv[3],"local")'
        with (output / 'rename-choice-crash.log').open('w', encoding='utf-8') as log:
            child = subprocess.Popen([sys.executable, '-c', code, str(state), target, view['fingerprint']], stdout=log, stderr=log)
            assert relay.committed.wait(35)
            child.kill(); child.wait(10); child = None
        relay.hold = False; relay.release.set()
        engine = Engine(state, stable_seconds=.01, delete_grace=0)
        actual = request('/notes/' + file['id']); version = actual['version']
        view = preview(engine, target); assert view['pending']
        resolve(engine, target, None, resume=view['pending'])
        assert request('/notes/' + file['id'])['version'] == version
        assert not (root / source).exists() and (root / target).read_bytes() == b'# durable renamed local choice\n'
        assert not engine.db.execute('SELECT * FROM local_rename').fetchall()

        # Fault injection: terminate only after the real target replacement completes.
        source = files[4]['path']; target = folder + '/local-write-crash.md'
        (root / source).write_bytes(b'# source kept until confirmed cleanup\n')
        file = moved(files[4], target)
        (root / target).write_bytes(b'# preexisting target must be backed up\n')
        engine.cycle(); view = preview(engine, target)
        engine.close(); engine = None
        code = '''import sys,os
from pathlib import Path
from privatespace_sync.engine import Engine
from privatespace_sync.conflicts import resolve
e=Engine(Path(sys.argv[1]))
original=e.fs.atomic
def stop_after_real_write(*args,**kwargs):
 original(*args,**kwargs)
 os._exit(73)
e.fs.atomic=stop_after_real_write
resolve(e,sys.argv[2],sys.argv[3],"local")
'''
        child = subprocess.Popen([sys.executable, '-c', code, str(state), target, view['fingerprint']])
        assert child.wait(35) == 73; child = None
        assert (root / source).exists() and (root / target).read_bytes() == b'# source kept until confirmed cleanup\n'
        engine = Engine(state, stable_seconds=.01, delete_grace=0)
        engine.cycle()  # This refreshes the move's observed remote version after publication.
        version = request('/notes/' + file['id'])['version']
        view = preview(engine, target); assert view['pending']
        resolve(engine, target, None, resume=view['pending'])
        assert request('/notes/' + file['id'])['version'] == version
        assert not (root / source).exists() and (root / target).read_bytes() == b'# source kept until confirmed cleanup\n'
        assert any(path.read_bytes() == b'# preexisting target must be backed up\n' for path in (state / 'recycle').glob('*.bin'))

        source = files[5]['path']; target = folder + '/5.MD'
        (root / source).write_bytes(b'# case-only local edit\n')
        file = moved(files[5], target); engine.cycle()
        view = preview(engine, target); resolve(engine, target, view['fingerprint'], 'local')
        assert (root / target).read_bytes() == b'# case-only local edit\n'
        assert '5.MD' in [path.name for path in (root / folder).iterdir()]
    finally:
        if child and child.poll() is None: child.kill(); child.wait(10)
        if engine: engine.close()
        relay.close()
    return ['explicit remote-rename server/local/real Tk merged choices keep server IDs and new paths, preserve original bytes, reject stale views and resume a real commit/ack process kill without duplicate publication']
