"""Opt-in current-user Startup shortcuts; never start automatic synchronization."""

import hashlib
from pathlib import Path
import subprocess
from .installer import powershell, read_shortcut, save_shortcut, safe

PREFIX = '私有空间同步助手-'


def folder():
    value = powershell("[Environment]::GetFolderPath('Startup')")
    if not value:
        raise OSError('无法读取当前用户的启动目录。')
    return Path(value)


def shortcut(state, directory):
    identity = hashlib.sha256(str(state.resolve()).casefold().encode('utf-8')).hexdigest()[:16]
    return directory / (PREFIX + identity + '.lnk')


def enabled(target, state, *, directory=None):
    link = shortcut(state, directory if directory is not None else folder())
    safe(link)
    if not link.exists():
        return False
    current = read_shortcut(link)
    expected = subprocess.list2cmdline(['--state', str(state.absolute())])
    if Path(current['target']).absolute() != target.absolute() or current['arguments'] != expected:
        raise ValueError('此配置的启动入口指向另一版本，请先从原版本关闭开机启动，或重新安装最新版本。')
    return True


def set_enabled(target, state, value, *, directory=None):
    directory = directory if directory is not None else folder()
    link = shortcut(state, directory)
    safe(link); safe(target)
    current = enabled(target, state, directory=directory)
    if value:
        if not target.is_file() or not (target.parent / '_internal').is_dir():
            raise ValueError('请保留完整助手程序目录后再启用开机启动。')
        if not current:
            directory.mkdir(parents=True, exist_ok=True)
            save_shortcut(link, target, subprocess.list2cmdline(['--state', str(state.absolute())]))
    elif current:
        link.unlink()
    return value
