"""Metadata reporting through real HTTP, including commit/ack process termination."""

import json
import sqlite3
import subprocess
import sys
from privatespace_sync.conflict_reporting import sync
from privatespace_sync.conflicts import preview, resolve
from privatespace_sync.engine import Engine
from privatespace_sync.transport import SyncError


def check_reporting(request, pair, create, edit, Relay, output):
    create('网页冲突验收', kind='folder')
    notes = [create(f'网页冲突验收/{index:03}.md', '# base\n') for index in range(25)]
    relay = Relay('/api/v1/sync/conflict-status', 1); relay.hold = False
    root, state, engine = pair('reporting', url=relay.url, scope={'all': False, 'folders': ['网页冲突验收']})
    _, _, unknown = pair('unreported', scope={'all': False, 'folders': ['网页冲突验收']})
    unknown_id = unknown.config['device']; unknown.close()
    child = None
    try:
        assert engine.cycle()['status'] == 'OK'
        for note in notes:
            (root / note['path']).write_bytes(b'# local variant\n')
            edit(note, '# server variant\n')
        assert len(engine.cycle()['conflicts']) == 25
        device = engine.config['device']; engine.close(); engine = None
        relay.hold = True
        code = 'import sys; from pathlib import Path; from privatespace_sync.engine import Engine; from privatespace_sync.conflict_reporting import sync; e=Engine(Path(sys.argv[1])); sync(e)'
        with (output / 'report-crash.log').open('w', encoding='utf-8') as log:
            child = subprocess.Popen([sys.executable, '-c', code, str(state)], stdout=log, stderr=log)
            assert relay.committed.wait(40), 'report did not commit'
            child.kill(); child.wait(10); child = None
        relay.hold = False; relay.release.set()
        with sqlite3.connect(state / 'sync.sqlite') as db:
            assert db.execute('SELECT COUNT(*) FROM conflict_report_outbox').fetchone()[0] == 1
        engine = Engine(state, stable_seconds=.01, delete_grace=0)
        sync(engine)
        assert engine.db.execute('SELECT COUNT(*) FROM conflict_report_outbox').fetchone()[0] == 0
        first = request('/sync-devices/' + device + '/conflicts?limit=20')
        assert first['reported'] and len(first['items']) == 20 and first['nextCursor']
        import urllib.parse
        second = request('/sync-devices/' + device + '/conflicts?limit=20&cursor=' + urllib.parse.quote(first['nextCursor']))
        assert len(second['items']) == 5 and second['nextCursor'] is None
        assert not set(item['path'] for item in first['items']) & set(item['path'] for item in second['items'])
        item = json.loads(engine.db.execute('SELECT metadata FROM conflict_reported ORDER BY path LIMIT 1').fetchone()[0])
        for body, expected in (({'revision': '1000', 'items': [{**item, 'path': '未选/拒绝.md'}]}, 403),
                               ({'revision': '1', 'items': [{**item, 'reason': 'DIFFERENT'}]}, 409),
                               ({'revision': '9223372036854775808', 'items': []}, 400),
                               ({'revision': '1000', 'items': [None]}, 400)):
            try:
                engine.remote.request('/conflict-status', body=body)
                raise AssertionError('unsafe metadata accepted')
            except SyncError as error:
                assert error.status == expected
        chosen = notes[0]['path']; review = preview(engine, chosen)
        resolve(engine, chosen, review['fingerprint'], 'server'); sync(engine)
        assert not any(item['path'] == chosen for item in request('/sync-devices/' + device + '/conflicts?limit=100')['items'])
        assert not request('/sync-devices/' + unknown_id + '/conflicts')['reported']
        (output / 'web-conflicts.json').write_text(json.dumps({'device': device, 'unknown': unknown_id,
            'name': '合并-reporting', 'unknownName': '合并-unreported', 'count': 24}), encoding='utf-8')
    finally:
        if child and child.poll() is None:
            child.kill(); child.wait(10)
        if engine: engine.close()
        relay.close()
    return ['real conflict metadata commit followed by process termination replays the durable outbox; 25 conflicts paginate 20/5, stale and out-of-scope reports are refused, resolution clears only its reported path and an unreported device remains unknown']
