"""Real conflict API, SQLite jobs, Windows files, Tk choices and kill-after-commit."""

import base64
import json
from pathlib import Path
import subprocess
import sys
import urllib.parse

from privatespace_sync.conflicts import preview, resolve
from privatespace_sync.engine import Engine
from privatespace_sync.filesystem import digest
from privatespace_sync.transport import SyncError


def check_conflicts(app, window, wait, request, pair, create, edit, upload, Relay, output, archived_path):
    checks = []
    # Exercise the actual main-window selection and manual editor on an archived conflict.
    app.item_page = 0; app.render_items()
    item = next(item for item in app.table.get_children() if app.table.item(item, 'values')[0] == archived_path)
    app.table.selection_set(item); window.update(); app.conflict_button.invoke()
    wait(lambda: app.conflict_dialog is not None and app.conflict_dialog.window.winfo_exists(), 'conflict dialog')
    dialog = app.conflict_dialog
    index = next(index for index, item in enumerate(dialog.review['variants']) if item['id'].startswith('archive:'))
    dialog.table.selection_set(str(index)); window.update(); dialog.manual.invoke(); window.update()
    dialog.editor.delete('1.0', 'end'); dialog.editor.insert('1.0', '# explicitly merged archived edit\r\n')
    dialog.save_merge.invoke()
    wait(lambda: app.snapshot['result'].get('status') == 'CONFLICT_RESOLVED', 'manual conflict resolution')
    saved = next(item for item in request('/notes?query=' + urllib.parse.quote(archived_path))['items'] if item['path'] == archived_path)
    assert request('/notes/' + saved['id'])['content'] == '# explicitly merged archived edit\r\n'
    checks.append('real Tk opens an archived conflict, reads preserved bytes and explicitly publishes a manual Markdown merge through the conditional backend API')

    create('冲突验收', kind='folder')
    note = create('冲突验收/双改.md', '# base\r\n')
    deleted = create('冲突验收/恢复.md', '# before deletion\r\n')
    relay = Relay('/api/v1/sync/conflict-files', 1); relay.hold = False
    root, state_dir, engine = pair('resolution', url=relay.url, scope={'all': False, 'folders': ['冲突验收']})
    child = None
    try:
        assert engine.cycle()['status'] == 'OK'
        (root / note['path']).write_bytes(b'# local variant\r\n')
        note = edit(note, '# server variant\r\n'); assert engine.cycle()['conflicts']
        review = preview(engine, note['path'])
        source = next(item['id'] for item in review['variants'] if item['id'].startswith('copy:'))
        note = edit(note, '# third edit\r\n')
        try:
            resolve(engine, note['path'], review['fingerprint'], source)
            raise AssertionError('stale choice overwrote server')
        except SyncError as error:
            assert error.code == 'CONFLICT_CHANGED'
        assert request('/notes/' + note['id'])['content'] == '# third edit\r\n'
        review = preview(engine, note['path']); resolve(engine, note['path'], review['fingerprint'], source)
        assert (root / note['path']).read_bytes() == b'# local variant\r\n'
        note = request('/notes/' + note['id']); assert note['version'] == '4'
        assert engine.fs.read(source.removeprefix('copy:')) == b'# local variant\r\n'
        checks.append('stale conflict choices are refused; fresh local-copy adoption preserves the file ID, increments one version and retains the original conflict copy')

        (root / deleted['path']).write_bytes(b'# surviving local modification\r\n')
        deleted = request('/notes/' + deleted['id'] + '?baseVersion=' + deleted['version'], method='DELETE')
        assert engine.cycle()['conflicts']
        review = preview(engine, deleted['path'])
        ordinary = {'id': deleted['id'], 'path': deleted['path'], 'baseVersion': deleted['version'], 'deleted': False,
            'sha256': digest(b'# surviving local modification\r\n'), 'contentBase64': base64.b64encode(b'# surviving local modification\r\n').decode()}
        try:
            engine.remote.request('/files', body=ordinary, operation=str(__import__('uuid').uuid4()))
            raise AssertionError('ordinary synchronization restored a tombstone')
        except SyncError as error:
            assert error.status == 409
        resolve(engine, deleted['path'], review['fingerprint'], 'local')
        restored = request('/notes/' + deleted['id'])
        assert not restored['deleted'] and restored['content'] == '# surviving local modification\r\n'
        assert restored['id'] == deleted['id'] and restored['version'] == '3'
        try:
            engine.remote.request('/conflict-files', body={**ordinary, 'path': '未选目录/不能发布.md', 'id': None, 'baseVersion': '0'}, operation=str(__import__('uuid').uuid4()))
            raise AssertionError('conflict publication escaped device scope')
        except SyncError as error:
            assert error.status == 403
        checks.append('explicit conflict resolution restores a deleted file at its expected version; ordinary sync still refuses resurrection, and the new API enforces actual device scope')

        binary = upload(engine.remote, '冲突验收/二进制.bin', b'\x00server\xff')
        assert engine.cycle()['status'] == 'OK'
        (root / binary['path']).write_bytes(b'\x00local\xfe')
        binary = engine.remote.request('/files', body={'id': binary['id'], 'path': binary['path'], 'baseVersion': binary['version'],
            'deleted': False, 'sha256': digest(b'\x00server-new\xff'), 'contentBase64': base64.b64encode(b'\x00server-new\xff').decode()}, operation=str(__import__('uuid').uuid4()))
        assert engine.cycle()['conflicts']
        review = preview(engine, binary['path']); source = next(item['id'] for item in review['variants'] if item['id'].startswith('copy:'))
        resolve(engine, binary['path'], review['fingerprint'], source)
        assert (root / binary['path']).read_bytes() == b'\x00local\xfe'
        checks.append('binary variants publish and download exact original bytes without text conversion')

        (root / restored['path']).write_bytes(b'# dirty local before server choice\r\n')
        restored = edit(restored, '# chosen server bytes\r\n'); assert engine.cycle()['conflicts']
        (root / restored['path']).write_bytes(b'# late local edit to recycle\r\n')
        review = preview(engine, restored['path']); resolve(engine, restored['path'], review['fingerprint'], 'server')
        assert (root / restored['path']).read_bytes() == b'# chosen server bytes\r\n'
        assert request('/notes/' + restored['id'])['version'] == restored['version']
        assert any(path.read_bytes() == b'# late local edit to recycle\r\n' for path in (state_dir / 'recycle').glob('*.bin'))
        (root / restored['path']).write_bytes(b'# preserved before accepting deletion\r\n')
        restored = request('/notes/' + restored['id'] + '?baseVersion=' + restored['version'], method='DELETE')
        assert engine.cycle()['conflicts']
        review = preview(engine, restored['path']); resolve(engine, restored['path'], review['fingerprint'], 'server')
        assert not (root / restored['path']).exists() and request('/notes/' + restored['id'])['deleted']
        assert any(path.read_bytes() == b'# preserved before accepting deletion\r\n' for path in (state_dir / 'recycle').glob('*.bin'))
        checks.append('adopting a live server version does not create another server version; adopting its tombstone removes only the confirmed local path, with exact prior bytes durably retained in the helper recycle directory')

        (root / note['path']).write_bytes(b'# interrupted resolution\r\n')
        note = edit(note, '# server before interruption\r\n'); assert engine.cycle()['conflicts']
        review = preview(engine, note['path']); source = next(item['id'] for item in review['variants'] if item['id'].startswith('copy:'))
        engine.close(); engine = None
        relay.posts = 0; relay.hold = True
        code = 'import sys; from pathlib import Path; from privatespace_sync.engine import Engine; from privatespace_sync.conflicts import resolve; e=Engine(Path(sys.argv[1])); resolve(e,sys.argv[2],sys.argv[3],sys.argv[4])'
        with (output / 'resolution-crash.log').open('w', encoding='utf-8') as log:
            child = subprocess.Popen([sys.executable, '-c', code, str(state_dir), note['path'], review['fingerprint'], source], stdout=log, stderr=log)
            assert relay.committed.wait(40), 'conflict write did not actually commit'
            child.kill(); child.wait(10); child = None
        relay.hold = False; relay.release.set()
        engine = Engine(state_dir, stable_seconds=.01, delete_grace=0)
        current = request('/notes/' + note['id']); expected_version = current['version']
        review = preview(engine, note['path']); assert review['pending']
        resolve(engine, note['path'], None, resume=review['pending'])
        assert request('/notes/' + note['id'])['version'] == expected_version
        assert (root / note['path']).read_bytes() == b'# interrupted resolution\r\n'
        assert not engine.status()['conflicts']
        checks.append('kill after the real conflict write commits retains the durable job; restart retries the same operation, restores local bytes and clears only that conflict without a duplicate version')
    finally:
        if child and child.poll() is None:
            child.kill(); child.wait(10)
        if engine:
            engine.close()
        relay.close()
    return checks
