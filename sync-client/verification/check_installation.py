"""Real built EXE, Tk installer, Windows shell shortcuts and process lifecycle in isolated directories."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from privatespace_sync.installer import create_installer, install_bundle, powershell, read_shortcut, save_shortcut, SHORTCUT
from privatespace_sync.single_instance import SingleInstance

parser = argparse.ArgumentParser()
parser.add_argument('--bundle', type=Path, required=True)
args = parser.parse_args()
source = args.bundle.resolve()
output = Path(__file__).resolve().parents[2] / 'frontend/test-results' / ('installation-' + str(uuid.uuid4()))
root = output / 'Programs/PrivateSpaceSync'
folders = (output / '桌面', output / '开始菜单')
state = output / 'isolated-state'
checks = []


def processes(target):
    script = """
$rows = @(Get-CimInstance Win32_Process -Filter ("Name='" + $p.name + "'") | Where-Object {$_.ExecutablePath -eq $p.target} | ForEach-Object {
  $process = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  @{id=$_.ProcessId; window=[string]$process.MainWindowHandle; title=$process.MainWindowTitle}
})
ConvertTo-Json -Compress -InputObject $rows
"""
    return json.loads(powershell(script, {'name': target.name, 'target': str(target)}))


def wait_window(target):
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        visible = [item for item in processes(target) if item['window'] != '0']
        if visible:
            assert len(visible) == 1
            return visible[0]
        time.sleep(.2)
    raise AssertionError('Built executable did not create a window: ' + str(target))


def close_window(target):
    for item in processes(target):
        if item['window'] != '0':
            powershell('[void]([Diagnostics.Process]::GetProcessById($p.id).CloseMainWindow())', {'id': item['id']})
    deadline = time.monotonic() + 25
    while processes(target):
        assert time.monotonic() < deadline, 'Application did not close safely'
        time.sleep(.2)


window = create_installer(source, root=root, folders=folders)
window.geometry('600x400+10000+10000'); window.update()
install = window.nametowidget('.body.controls.install')
opened = window.nametowidget('.body.controls.open')
targets = []
installer_process = None
try:
    body = window.nametowidget('.body')
    controls = window.nametowidget('.body.controls')
    assert controls.winfo_y() + controls.winfo_height() <= body.winfo_height()
    install.invoke()
    deadline = time.monotonic() + 70
    while opened.instate(['disabled']):
        window.update(); time.sleep(.03)
        assert install.instate(['disabled']), 'Installer reported failure'
        assert time.monotonic() < deadline, 'Installation timeout'
    metadata = json.loads((root / 'install.json').read_text())
    first = root / metadata['executable']; targets.append(first)
    assert first.is_file() and (first.parent / '_internal').is_dir()
    for folder in folders:
        assert Path(read_shortcut(folder / SHORTCUT)['target']) == first
    progress = window.nametowidget('.body.progress')
    assert int(progress['value']) == int(progress['maximum']) == metadata['files']
    window.nametowidget('.body.controls.close').invoke()
    window = None
    checks.append('Real Tk installation copies and hashes complete built bundle; two real Windows shortcuts and metadata persist; minimum-size actions are visible')

    arguments = subprocess.list2cmdline(['--state', str(state)])
    for folder in folders:
        save_shortcut(folder / SHORTCUT, first, arguments)
    os.startfile(folders[0] / SHORTCUT)
    original = wait_window(first)
    assert '同步助手' in original['title']
    second_click = subprocess.run([str(first), '--state', str(state)], timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
    assert second_click.returncode == 0
    assert wait_window(first)['id'] == original['id']
    checks.append('Desktop shortcut really launches installed EXE; repeated EXE launch exits without a second GUI')

    second, links = install_bundle(source, root, folders=folders, arguments=arguments)
    targets.append(second)
    assert second != first and first.is_file()
    assert Path(read_shortcut(links[0])['target']) == second
    duplicate = subprocess.run([str(second), '--state', str(state)], timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
    assert duplicate.returncode == 0 and wait_window(first)['id'] == original['id']
    close_window(first)
    os.startfile(links[1])
    current = wait_window(second)
    assert current['id'] != original['id']
    close_window(second)
    instance = SingleInstance(state)
    assert instance.primary
    instance.close()
    checks.append('Update preserves running old release; new shortcut wakes old owner until exit; Start menu shortcut then starts the new release; normal exit releases GUI ownership')

    alias = source / '安装同步助手.exe'
    targets.append(alias)
    installer_process = subprocess.Popen([str(alias)], creationflags=subprocess.CREATE_NO_WINDOW)
    assert wait_window(alias)['title'] == '安装私有空间同步助手'
    close_window(alias)
    assert installer_process.wait(timeout=10) == 0
    checks.append('Renamed packaged installer entry opens the actual installer window and closes normally without installing to the user profile')
    report = {'checks': checks, 'copiedFiles': metadata['files'], 'actualUserProfileUsed': False,
              'packagedStartupAndDuplicateLaunch': True, 'packagedFullSyncRoundtrip': False,
              'state': str(state), 'output': str(output)}
    (output / 'installation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True))
finally:
    if window is not None:
        window.destroy()
    for target in targets:
        if processes(target):
            close_window(target)
