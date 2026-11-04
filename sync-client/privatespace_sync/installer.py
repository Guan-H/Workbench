"""Per-user installation of the complete onedir bundle; sync state stays in its existing location."""

import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from queue import Empty, Queue
import shutil
import subprocess
import tempfile
import threading
import uuid

from .state_lock import StateLock

PRODUCT = 'com.privatespace.sync'
EXECUTABLE = 'privatespace-sync.exe'
SHORTCUT = '私有空间同步助手.lnk'


def default_root():
    return Path(os.environ['LOCALAPPDATA']) / 'Programs' / 'PrivateSpaceSync'


def safe(path):
    if any(item.is_symlink() or item.is_junction() for item in (path, *path.parents)):
        raise ValueError('安装路径不能包含符号链接或目录联接。')


def powershell(script, data=None):
    executable = Path(os.environ['SystemRoot']) / 'System32' / 'WindowsPowerShell' / 'v1.0' / 'powershell.exe'
    if not executable.is_file():
        raise ValueError('未找到 Windows 自带 PowerShell，无法创建快捷方式。')
    if data is not None:
        payload = base64.b64encode(json.dumps(data, ensure_ascii=False).encode('utf-8')).decode('ascii')
        script = "$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + payload + "')) | ConvertFrom-Json\n" + script
    script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)\n" + script
    encoded = base64.b64encode(script.encode('utf-16-le')).decode('ascii')
    result = subprocess.run([str(executable), '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
                            capture_output=True, encoding='utf-8', creationflags=subprocess.CREATE_NO_WINDOW, timeout=45)
    if result.returncode:
        raise OSError(f'无法创建 Windows 快捷方式，请检查桌面和开始菜单的写入权限后重试（退出码 {result.returncode}）。') from subprocess.CalledProcessError(result.returncode, str(executable), stderr=result.stderr)
    return result.stdout.strip()


def shortcut_folders():
    result = json.loads(powershell("@{desktop=[Environment]::GetFolderPath('DesktopDirectory'); programs=[Environment]::GetFolderPath('Programs')} | ConvertTo-Json -Compress"))
    if not result['desktop'] or not result['programs']:
        raise ValueError('无法读取当前用户的桌面或开始菜单位置。')
    return Path(result['desktop']), Path(result['programs']) / '私有空间'


def save_shortcut(path, target, arguments=''):
    powershell("$s=(New-Object -ComObject WScript.Shell).CreateShortcut($p.path); $s.TargetPath=$p.target; $s.Arguments=$p.arguments; $s.WorkingDirectory=$p.directory; $s.IconLocation=$p.target+',0'; $s.Description='私有空间同步助手'; $s.Save()",
               {'path': str(path), 'target': str(target), 'directory': str(target.parent), 'arguments': arguments})


def read_shortcut(path):
    return json.loads(powershell("$s=(New-Object -ComObject WScript.Shell).CreateShortcut($p.path); @{target=$s.TargetPath; arguments=$s.Arguments} | ConvertTo-Json -Compress", {'path': str(path)}))


def install_bundle(source, root, *, folders=None, progress=None, arguments='', startup_directory=None):
    source, root = source.absolute(), root.absolute()
    safe(source); safe(root)
    source = source.resolve()
    if source == root or source.is_relative_to(root) or root.is_relative_to(source):
        raise ValueError('安装位置不能与解压目录重叠。')
    files = [source / EXECUTABLE]
    internal = source / '_internal'
    if not files[0].is_file() or not internal.is_dir():
        raise ValueError('安装文件不完整，请重新解压整个助手包。')
    safe(internal); safe(files[0])
    for directory, directories, names in os.walk(internal, followlinks=False):
        for name in directories + names:
            safe(Path(directory) / name)
        files += sorted(Path(directory) / name for name in names)
    with StateLock(root.with_name(root.name + '-install')):
        metadata = root / 'install.json'
        owner = root / '.product-id'
        safe(metadata); safe(owner)
        previous = json.loads(metadata.read_text(encoding='utf-8')) if metadata.exists() else None
        managed = previous and previous.get('product') == PRODUCT or owner.is_file() and owner.read_text(encoding='ascii') == PRODUCT
        if root.exists() and any(root.iterdir()) and not managed:
            raise ValueError('安装位置已有其他内容，已停止以保留原文件。')
        destinations = folders if folders is not None else shortcut_folders()
        links = [Path(folder) / SHORTCUT for folder in destinations]
        old_links = {}
        for link in links:
            safe(link)
            if link.exists():
                old_target = Path(read_shortcut(link)['target']).absolute()
                if not old_target.is_relative_to(root):
                    raise ValueError('同名快捷方式指向其他程序，请先重命名该快捷方式。')
                old_links[link] = link.read_bytes()
            else:
                old_links[link] = None
        # Update only shortcuts already opted into for this exact managed release.
        # Tests with isolated folders never enumerate the real user's Startup folder.
        startup_links = []
        if previous:
            from .startup import folder as startup_folder, PREFIX
            directory = startup_directory if startup_directory is not None else startup_folder() if folders is None else None
            old_executable = (root / previous['executable']).absolute()
            safe(old_executable)
            if not old_executable.is_relative_to(root):
                raise ValueError('原安装记录的程序路径无效。')
            if directory is not None:
                safe(directory)
                for link in directory.glob(PREFIX + '*.lnk'):
                    safe(link)
                    item = read_shortcut(link)
                    if Path(item['target']).absolute() == old_executable:
                        old_links[link] = link.read_bytes()
                        startup_links.append((link, item['arguments']))
        release = root / 'releases' / uuid.uuid4().hex
        safe(release)
        release.mkdir(parents=True)
        if not owner.exists():
            owner.write_text(PRODUCT, encoding='ascii')
        target = release / EXECUTABLE
        changed = []
        try:
            for index, path in enumerate(files, 1):
                destination = release / path.relative_to(source)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, destination)
                with path.open('rb') as original, destination.open('rb') as copied:
                    identical = hashlib.file_digest(original, 'sha256').digest() == hashlib.file_digest(copied, 'sha256').digest()
                if not identical:
                    raise OSError('安装文件校验失败，请重试。')
                if progress:
                    progress(index, len(files))
            for link in links:
                link.parent.mkdir(parents=True, exist_ok=True)
                changed.append(link)
                save_shortcut(link, target, arguments)
            for link, startup_arguments in startup_links:
                changed.append(link)
                save_shortcut(link, target, startup_arguments)
            descriptor, temporary = tempfile.mkstemp(prefix='.install-', dir=root)
            try:
                with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
                    json.dump({'product': PRODUCT, 'executable': target.relative_to(root).as_posix(),
                               'installedAt': datetime.now(timezone.utc).isoformat(), 'files': len(files)}, output)
                    output.flush(); os.fsync(output.fileno())
                os.replace(temporary, metadata)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            return target, links
        except Exception:
            for link in changed:
                if old_links[link] is None:
                    link.unlink(missing_ok=True)
                else:
                    link.write_bytes(old_links[link])
            # Failed copies stay in an unreferenced release; never remove user files or a running old version.
            raise


def create_installer(source, *, root=None, folders=None):
    import tkinter as tk
    from tkinter import ttk
    destination_root = root or default_root()
    window = tk.Tk(); window.title('安装私有空间同步助手'); window.geometry('640x420'); window.minsize(600, 400)
    body = ttk.Frame(window, name='body', padding=24); body.pack(fill='both', expand=True)
    body.columnconfigure(0, weight=1); body.rowconfigure(5, weight=1)
    ttk.Label(body, text='安装私有空间同步助手', font=('Microsoft YaHei UI', 16, 'bold')).grid(row=0, sticky='w', pady=(0, 16))
    ttk.Label(body, text='安装到当前用户目录，并创建桌面和开始菜单快捷方式。\n以后双击“私有空间同步助手”即可启动。无需管理员权限。', wraplength=580).grid(row=1, sticky='w')
    ttk.Label(body, text='安装位置：' + str(destination_root), wraplength=580).grid(row=2, sticky='w', pady=14)
    ttk.Label(body, text='已有配对、队列和同步文件保留。安装不会开启开机启动或自动同步。', wraplength=580).grid(row=3, sticky='w')
    bar = ttk.Progressbar(body, name='progress', mode='determinate'); bar.grid(row=4, sticky='ew', pady=(18, 8))
    feedback = ttk.Frame(body); feedback.grid(row=5, sticky='nsew')
    status = tk.Text(feedback, name='status', height=3, wrap='word', state='disabled', relief='flat', background=window.cget('background'))
    status.pack(side='left', fill='both', expand=True)
    scroll = ttk.Scrollbar(feedback, orient='vertical', command=status.yview); scroll.pack(side='right', fill='y'); status.configure(yscrollcommand=scroll.set)
    def set_status(text):
        status.configure(state='normal'); status.delete('1.0', 'end'); status.insert('1.0', text); status.configure(state='disabled')
    set_status('准备安装。更新前请正常退出旧版助手。')
    controls = ttk.Frame(body, name='controls'); controls.grid(row=6, sticky='ew', pady=(12, 0))
    events = Queue(); busy = False; installed = None
    def begin():
        nonlocal busy
        busy = True; install.configure(state='disabled'); set_status('正在复制并校验程序文件…')
        def work():
            try:
                target, links = install_bundle(source, destination_root, folders=folders, progress=lambda done, total: events.put(('progress', done, total)))
                events.put(('done', target, links))
            except Exception as error:
                events.put(('error', str(error)))
        threading.Thread(target=work, name='private-space-installer', daemon=True).start()
    def close():
        if busy:
            set_status('正在安装，请等待当前安装完成后关闭。')
        else:
            window.destroy()
    def launch():
        subprocess.Popen([str(installed)], creationflags=subprocess.CREATE_NO_WINDOW)
        window.destroy()
    def poll():
        nonlocal busy, installed
        try:
            while True:
                event = events.get_nowait()
                if event[0] == 'progress':
                    bar.configure(maximum=event[2], value=event[1]); set_status(f'已复制并校验 {event[1]} / {event[2]} 个文件…')
                elif event[0] == 'done':
                    busy = False; installed = event[1]
                    set_status('安装成功，桌面和开始菜单快捷方式已创建。旧版若仍在运行，请先退出。')
                    open_button.configure(state='normal'); cancel.configure(text='完成')
                else:
                    busy = False; set_status('安装失败：' + event[1]); install.configure(state='normal')
        except Empty:
            pass
        window.install_timer = window.after(100, poll)
    cancel = ttk.Button(controls, name='close', text='取消', command=close); cancel.pack(side='right')
    open_button = ttk.Button(controls, name='open', text='打开同步助手', command=launch, state='disabled'); open_button.pack(side='right', padx=8)
    install = ttk.Button(controls, name='install', text='安装并创建快捷方式', command=begin); install.pack(side='left')
    def reflow(_):
        for child in body.winfo_children():
            if isinstance(child, ttk.Label) and float(child.cget('wraplength') or 0):
                child.configure(wraplength=max(300, body.winfo_width() - 48))
    def destroyed(event):
        if event.widget == window:
            window.after_cancel(window.install_timer)
    body.bind('<Configure>', reflow); window.bind('<Destroy>', destroyed, add='+')
    window.protocol('WM_DELETE_WINDOW', close); window.bind('<Escape>', lambda _: close()); install.focus_set()
    poll()
    return window


def show_installer(source):
    create_installer(source).mainloop()
