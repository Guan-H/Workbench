"""Tkinter entry for the first M2 slice. File synchronization remains owned by SyncWorker."""

from __future__ import annotations

import os
from pathlib import Path
from queue import Empty
import tkinter as tk
from tkinter import filedialog, ttk

from .desktop_worker import PairCommand, SyncWorker


ERRORS = {
    'M0_REQUIRES_NEW_EMPTY_DIRECTORY': '请选择一个新的空目录；当前版本不会接管已有文件库。',
    'STATE_ALREADY_EXISTS': '此状态目录已有配对信息，请使用现有配置或指定另一个状态目录。',
    'STATE_IN_USE': '另一个助手或命令正在使用此状态目录，请先退出另一个进程。',
    'STATE_MUST_BE_SEPARATE': '同步目录和助手状态目录不能重叠。',
    'UNSAFE_LINK': '目录包含符号链接或目录联接，已停止操作。',
    'HTTPS_REQUIRED': '服务器须使用 HTTPS；本机开发仅允许 localhost 或 127.0.0.1 的 HTTP 地址。',
    'INVALID_PAIRING': '配对码无效、已使用或过期，请在网页生成新码。',
    'DEVICE_UNAUTHORIZED': '设备授权无效或已撤销，已暂停同步。',
    'NETWORK_UNAVAILABLE': '无法连接服务器，队列保留；自动监听时按退避间隔重试。',
    'LOCAL_CONFIGURATION_UNAVAILABLE': '无法读取本地配置或解密设备凭据，请检查当前 Windows 用户和状态目录。',
    'LOCAL_IO_UNAVAILABLE': '本地文件或数据库操作失败，已暂停。',
    'ROOT_UNAVAILABLE': '同步目录暂不可用，已暂停，不会据此传播删除。',
    'ROOT_IDENTITY_CHANGED': '同步目录标记不一致，已暂停，需重新核对目录。',
    'PAIR_FIRST': '先选择新空目录并配对。',
    'ALREADY_PAIRED': '当前助手已配对。',
    'DIRECTORY_WATCH_UNAVAILABLE': '文件监听不可用，已暂停，请检查目录权限。',
    'INTERNAL_ERROR': '助手发生内部错误，已停止，请保留状态目录并重新启动。',
}

PHASES = {
    'UNPAIRED': '尚未配对', 'PAIRING': '正在配对…', 'PAUSED': '已暂停，文件与队列保留',
    'RUNNING': '本轮同步中；暂停会等待当前文件安全操作结束',
    'WATCHING': '本轮检查完成，正在监听本地变化', 'READY': '本轮检查完成，自动监听未开启',
    'OFFLINE': '连接中断，等待重试', 'ATTENTION': '有待处理项，自动同步已暂停', 'ERROR': '操作失败，已暂停',
}


class SyncApp:
    def __init__(self, window: tk.Tk, state: Path):
        self.window = window
        self.state = state
        self.worker = SyncWorker(state)
        self.phase = 'UNPAIRED'
        self.closing = False
        self.snapshot: dict = {}
        self.items: list[tuple[str, str]] = []
        self.item_page = 0
        self.deletion_dialog: tk.Toplevel | None = None
        self.url = tk.StringVar(value='http://127.0.0.1:8080')
        self.directory = tk.StringVar()
        self.code = tk.StringVar()
        self.status = tk.StringVar(value='正在读取本地配置…')
        self.summary = tk.StringVar(value='尚未完成同步检查')
        self.page_label = tk.StringVar()
        window.title('私有空间 · 同步助手')
        window.geometry('860x650')
        window.minsize(720, 560)
        window.protocol('WM_DELETE_WINDOW', self.close)
        style = ttk.Style(window)
        style.configure('Heading.TLabel', font=('Microsoft YaHei UI', 16, 'bold'))
        style.configure('Status.TLabel', foreground='#39765b')
        body = ttk.Frame(window, padding=20)
        body.pack(fill='both', expand=True)
        body.columnconfigure(1, weight=1)
        body.rowconfigure(9, weight=1)
        ttk.Label(body, text='同步助手', style='Heading.TLabel').grid(row=0, column=0, columnspan=3, sticky='w', pady=(0, 12))
        ttk.Label(body, text='首批仅支持新空目录与最多 5000 对象的全量快照。非空合并、增量和冲突解决尚在开发。',
                  wraplength=780).grid(row=1, column=0, columnspan=3, sticky='ew', pady=(0, 16))
        ttk.Label(body, text='服务器地址').grid(row=2, column=0, sticky='w', padx=(0, 12))
        self.url_entry = ttk.Entry(body, textvariable=self.url)
        self.url_entry.grid(row=2, column=1, columnspan=2, sticky='ew', pady=6)
        ttk.Label(body, text='本地新空目录').grid(row=3, column=0, sticky='w')
        self.directory_entry = ttk.Entry(body, textvariable=self.directory)
        self.directory_entry.grid(row=3, column=1, sticky='ew', pady=6)
        self.choose_button = ttk.Button(body, text='选择目录', command=self.choose)
        self.choose_button.grid(row=3, column=2, padx=(10, 0))
        ttk.Label(body, text='一次性配对码').grid(row=4, column=0, sticky='w')
        self.code_entry = ttk.Entry(body, textvariable=self.code, show='•')
        self.code_entry.grid(row=4, column=1, sticky='ew', pady=6)
        self.pair_button = ttk.Button(body, text='配对', command=self.pair)
        self.pair_button.grid(row=4, column=2, padx=(10, 0))
        controls = ttk.Frame(body)
        controls.grid(row=5, column=0, columnspan=3, sticky='w', pady=16)
        self.start_button = ttk.Button(controls, text='开始监听', command=lambda: self.run(True))
        self.pause_button = ttk.Button(controls, text='暂停', command=self.pause)
        self.once_button = ttk.Button(controls, text='手动同步', command=self.run)
        self.open_button = ttk.Button(controls, text='打开目录', command=self.open_directory)
        self.preview_button = ttk.Button(controls, text='查看删除预览', command=self.preview_deletions)
        for button in (self.start_button, self.pause_button, self.once_button, self.open_button, self.preview_button):
            button.pack(side='left', padx=(0, 8))
        ttk.Label(body, textvariable=self.status, style='Status.TLabel', wraplength=780).grid(row=6, column=0, columnspan=3, sticky='ew', pady=(0, 8))
        ttk.Label(body, textvariable=self.summary, wraplength=780).grid(row=7, column=0, columnspan=3, sticky='ew', pady=(0, 12))
        ttk.Label(body, text='待处理项与错误').grid(row=8, column=0, columnspan=3, sticky='w')
        listing = ttk.Frame(body)
        listing.grid(row=9, column=0, columnspan=3, sticky='nsew', pady=8)
        listing.columnconfigure(0, weight=1); listing.rowconfigure(0, weight=1)
        self.table = ttk.Treeview(listing, columns=('path', 'reason'), show='headings', height=6)
        self.table.heading('path', text='文件 / 项目'); self.table.heading('reason', text='状态 / 错误代码')
        self.table.column('path', width=440, minwidth=150); self.table.column('reason', width=220, minwidth=150)
        self.table.grid(row=0, column=0, sticky='nsew')
        scroll = ttk.Scrollbar(listing, orient='vertical', command=self.table.yview)
        scroll.grid(row=0, column=1, sticky='ns'); self.table.configure(yscrollcommand=scroll.set)
        pager = ttk.Frame(body)
        pager.grid(row=10, column=0, columnspan=3, sticky='e')
        self.previous_button = ttk.Button(pager, text='上一页', command=lambda: self.turn_page(-1))
        self.previous_button.pack(side='left')
        ttk.Label(pager, textvariable=self.page_label).pack(side='left', padx=10)
        self.next_button = ttk.Button(pager, text='下一页', command=lambda: self.turn_page(1))
        self.next_button.pack(side='left')
        ttk.Label(body, text='状态目录：' + str(state), wraplength=780).grid(row=11, column=0, columnspan=3, sticky='w', pady=(12, 0))
        def reflow(_):
            for child in body.winfo_children():
                if isinstance(child, ttk.Label) and float(child.cget('wraplength') or 0) > 0:
                    child.configure(wraplength=max(320, body.winfo_width() - 40))
        body.bind('<Configure>', reflow)
        self.render_items()
        self.update_controls(False, True)
        self.worker.start()
        self.window.after(100, self.poll)

    def choose(self):
        selected = filedialog.askdirectory(parent=self.window, title='选择新建的空目录', mustexist=True)
        if selected:
            self.directory.set(selected)

    def pair(self):
        if not self.url.get().strip() or not self.directory.get().strip() or not self.code.get().strip():
            self.status.set('填写服务器地址，选择新空目录，并输入网页生成的配对码。')
            return
        command = PairCommand(self.url.get().strip(), Path(self.directory.get()), self.code.get().strip())
        self.code.set('')
        self.update_controls(False, True)
        self.worker.commands.put(command)

    def run(self, automatic: bool = False):
        self.update_controls(True, True)
        self.worker.run_cycle(automatic=automatic)

    def pause(self):
        self.status.set('正在暂停，等待当前文件安全操作结束…')
        self.worker.pause()

    def open_directory(self):
        path = self.snapshot.get('root')
        if path and Path(path).is_dir():
            os.startfile(path)
        else:
            self.status.set('目录当前不可用。')

    def update_controls(self, paired: bool, busy: bool):
        for field in (self.url_entry, self.directory_entry, self.code_entry, self.choose_button, self.pair_button):
            field.configure(state='disabled' if paired or busy or self.closing else 'normal')
        for button in (self.start_button, self.once_button):
            button.configure(state='normal' if paired and not busy and not self.closing and not self.worker.stopped.is_set() else 'disabled')
        self.pause_button.configure(state='normal' if paired and not self.closing else 'disabled')
        self.open_button.configure(state='normal' if paired else 'disabled')
        preview = self.snapshot.get('result', {}).get('deletionPreview')
        self.preview_button.configure(state='normal' if preview and not busy and not self.closing else 'disabled')

    def turn_page(self, offset: int):
        self.item_page += offset
        self.render_items()

    def render_items(self):
        pages = max(1, (len(self.items) + 19) // 20)
        self.item_page = max(0, min(self.item_page, pages - 1))
        self.table.delete(*self.table.get_children())
        for path, reason in self.items[self.item_page * 20:(self.item_page + 1) * 20]:
            self.table.insert('', 'end', values=(path, reason))
        self.page_label.set(f'第 {self.item_page + 1} / {pages} 页 · 每页 20 项')
        self.previous_button.configure(state='normal' if self.item_page else 'disabled')
        self.next_button.configure(state='normal' if self.item_page + 1 < pages else 'disabled')

    def poll(self):
        try:
            while True:
                event = self.worker.events.get_nowait()
                self.snapshot = event
                self.phase = event['phase']
                paired = event['root'] is not None
                if paired:
                    self.directory.set(event['root']); self.url.set(event['url'])
                text = PHASES[self.phase]
                if event['code']:
                    text += '。' + ERRORS.get(event['code'], '请检查待处理项并重试。') + ' [' + event['code'] + ']'
                self.status.set(text)
                result = event['result']
                self.summary.set(f"最近核对：队列 {result.get('queued', 0)} 项，冲突 {len(result.get('conflicts', []))} 项，问题 {len(result.get('issues', []))} 项。" if result else '尚未完成同步检查')
                self.items = [(item.get('path', ''), item.get('code', '')) for item in result.get('issues', [])]
                self.items += [(item['path'], '冲突：' + item['reason']) for item in result.get('conflicts', [])]
                self.items += [(item['path'], '待确认删除：' + item['direction']) for item in (result.get('deletionPreview') or {}).get('changes', [])]
                self.render_items()
                self.update_controls(paired, self.phase in ('PAIRING', 'RUNNING'))
        except Empty:
            pass
        if self.closing and self.worker.stopped.is_set():
            self.window.destroy()
        else:
            self.window.after(100, self.poll)

    def preview_deletions(self):
        preview = self.snapshot.get('result', {}).get('deletionPreview')
        if not preview or self.deletion_dialog and self.deletion_dialog.winfo_exists():
            return
        dialog = self.deletion_dialog = tk.Toplevel(self.window)
        dialog.title('确认本批删除'); dialog.transient(self.window); dialog.grab_set()
        dialog.geometry('660x420'); dialog.minsize(520, 340)
        frame = ttk.Frame(dialog, padding=16); frame.pack(fill='both', expand=True)
        ttk.Label(frame, text=f"本轮拟删除 {len(preview['changes'])} 项。确认前核对方向和路径；只确认当前预览。", wraplength=620).pack(anchor='w', pady=(0, 12))
        page = 0
        listing = ttk.Frame(frame); listing.pack(fill='both', expand=True)
        content = tk.Text(listing, height=13, wrap='word', state='disabled')
        content.pack(side='left', fill='both', expand=True)
        scroll = ttk.Scrollbar(listing, orient='vertical', command=content.yview)
        scroll.pack(side='right', fill='y'); content.configure(yscrollcommand=scroll.set)
        controls = ttk.Frame(frame); controls.pack(fill='x', pady=(12, 0))
        label = ttk.Label(controls)
        def render(offset=0):
            nonlocal page
            count = max(1, (len(preview['changes']) + 19) // 20)
            page = max(0, min(count - 1, page + offset))
            content.configure(state='normal'); content.delete('1.0', 'end')
            for item in preview['changes'][page * 20:(page + 1) * 20]:
                content.insert('end', ('删除服务器文件：' if item['direction'] == 'remote' else '删除本地文件并保留回收副本：') + item['path'] + '\n')
            content.configure(state='disabled'); label.configure(text=f'{page + 1} / {count} 页')
            previous.configure(state='normal' if page else 'disabled'); following.configure(state='normal' if page + 1 < count else 'disabled')
        previous = ttk.Button(controls, text='上一页', command=lambda: render(-1)); previous.pack(side='left')
        label.pack(side='left', padx=8)
        following = ttk.Button(controls, text='下一页', command=lambda: render(1)); following.pack(side='left')
        def confirm():
            dialog.destroy(); self.update_controls(True, True)
            self.worker.run_cycle(confirmation=preview['fingerprint'])
        ttk.Button(controls, text='取消', command=dialog.destroy).pack(side='right')
        ttk.Button(controls, text='确认本批删除', command=confirm).pack(side='right', padx=8)
        dialog.bind('<Escape>', lambda _: dialog.destroy())
        render()

    def close(self):
        if not self.closing:
            self.closing = True
            self.status.set('正在安全退出，等待当前文件操作完成；队列和草稿不会清除。')
            self.update_controls(self.snapshot.get('root') is not None, True)
            self.worker.close()


def run(state: Path):
    window = tk.Tk()
    SyncApp(window, state)
    window.mainloop()
