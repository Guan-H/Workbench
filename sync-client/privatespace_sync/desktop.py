"""Tkinter entry for the first M2 slice. File synchronization remains owned by SyncWorker."""

from __future__ import annotations

import os
from pathlib import Path
from queue import Empty
import tkinter as tk
from tkinter import filedialog, ttk

from .desktop_worker import ConflictCommand, PairCommand, ReconcilePreviewCommand, SyncWorker


ERRORS = {
    'M0_REQUIRES_NEW_EMPTY_DIRECTORY': '请选择一个新的空目录；当前版本不会接管已有文件库。',
    'DIRECTORY_ALREADY_BOUND': '此目录已有同步绑定标记，请使用原配置；不能由其他配置接管。',
    'INITIAL_MERGE_CHANGED': '两端内容或同步范围已变化，原确认已失效；请重新查看合并预检。',
    'RECONCILIATION_CHANGED': '对账预检已变化，原确认失效；请重新查看当前对账预检。',
    'CONFLICT_CHANGED': '文件或版本已变化，未采用旧选择；请刷新冲突版本，合并草稿保留在当前助手内存。',
    'CONFLICT_NOT_FOUND': '此冲突已处理或不在当前范围，请刷新待处理列表。',
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
    'PAIR_FIRST': '先选择未绑定的本地目录并配对；已有内容会在同步前预检。',
    'ALREADY_PAIRED': '当前助手已配对。',
    'DIRECTORY_WATCH_UNAVAILABLE': '文件监听不可用，已暂停，请检查目录权限。',
    'INTERNAL_ERROR': '助手发生内部错误，已停止，请保留状态目录并重新启动。',
    'SYNC_SCOPE_CHANGED': '网页同步范围已变化，请重新执行同步以读取新范围；已有文件保留。',
    'OUTSIDE_SYNC_SCOPE': '文件已不在设备同步范围内，未发布修改或删除。',
    'INVALID_PROFILE_NAME': '配置名称须为 1–80 个字符。',
    'PROFILE_NOT_FOUND': '所选配置不存在，请重新打开配置管理。',
    'PROFILE_ROOT_OVERLAP': '此目录与已有配置的同步目录或助手状态目录重叠，请选择独立的未绑定目录。',
    'DIRECTORY_PATH_CONFLICT': '服务器目录与本地同名文件冲突，已保留本地文件，请检查待处理路径。',
    'PARENT_DIRECTORY_UNAVAILABLE': '原有文件的父目录缺失，已停止该范围操作，避免误传删除。',
    'RENAME_SERVER_UPGRADE_REQUIRED': '此服务器尚未支持保留文件身份的改名；已暂停，未新增或删除文件。请先升级服务端。',
    'RENAME_REQUIRES_RECONCILIATION': '改名遇到路径、版本或本地内容冲突，双方文件保留，请核对待处理项。',
    'LOCAL_CHANGED_BEFORE_RENAME': '改名预检后本地文件又发生变化，未执行旧预览，请核对文件后重试。',
    'SYNC_CURSOR_EXPIRED': '同步记录已过期，已暂停；本地文件和队列保留，需要重新对账，不会自动删除或复活旧文件。',
    'SERVER_ROLLBACK_RECONCILIATION_REQUIRED': '服务器版本游标回退，已暂停；请保留本地文件和队列并核对服务器恢复情况。',
    'INVALID_SYNC_RESPONSE': '目录响应不完整或分页参数无效，未提交本轮目录缓存；请重试。',
    'SYNC_SNAPSHOT_EXPIRED': '本轮目录分页已失效，请手动重试；原文件、基线和同步队列均已保留。',
    'DELETED_REMOTE_REQUIRES_RECONCILIATION': '此路径有服务器删除记录，本地文件已保留；请先重新对账，不会自动重新上传。',
}

PHASES = {
    'UNPAIRED': '尚未配对', 'PAIRING': '正在配对…', 'PAUSED': '已暂停，文件与队列保留',
    'RUNNING': '本轮同步中；暂停会等待当前文件安全操作结束',
    'WATCHING': '本轮检查完成，正在监听本地变化', 'READY': '本轮检查完成，自动监听未开启',
    'OFFLINE': '连接中断，等待重试', 'ATTENTION': '有待处理项，自动同步已暂停', 'ERROR': '操作失败，已暂停',
    'CONFIGURING': '正在停止原配置并切换，原文件与待上传内容保留…',
}


class SyncApp:
    def __init__(self, window: tk.Tk, state: Path):
        self.window = window
        self.state = state
        self.worker = SyncWorker(state)
        self.phase = 'UNPAIRED'
        self.closing = False
        self.reconfiguring = False
        self.configuration_dialog: tk.Toplevel | None = None
        self.snapshot: dict = {}
        self.items: list[tuple[str, str]] = []
        self.item_page = 0
        self.deletion_dialog: tk.Toplevel | None = None
        self.merge_dialog: tk.Toplevel | None = None
        self.conflict_dialog = None
        self.conflict_draft = None
        self.url = tk.StringVar(value='http://127.0.0.1:8080')
        self.directory = tk.StringVar()
        self.code = tk.StringVar()
        self.status = tk.StringVar(value='正在读取本地配置…')
        self.summary = tk.StringVar(value='尚未完成同步检查；范围以网页设备设置为准')
        self.scope_label = tk.StringVar(value='同步范围：配对时在网页选择“全部”或一个/多个目录。')
        self.state_label = tk.StringVar(value='状态目录：' + str(state))
        self.profile_label = tk.StringVar(value='正在读取配置…')
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
        ttk.Label(body, text='同步助手', style='Heading.TLabel').grid(row=0, column=0, columnspan=2, sticky='w', pady=(0, 12))
        self.configure_button = ttk.Button(body, text='更换服务器 / 目录', command=self.manage_profiles)
        self.configure_button.grid(row=0, column=2, sticky='e', pady=(0, 12))
        ttk.Label(body, text='可选择新目录或已有目录。已有内容先预检并确认，同名不同内容保留双方；完整冲突解决仍在开发。',
                  wraplength=780).grid(row=1, column=0, columnspan=3, sticky='ew', pady=(0, 16))
        ttk.Label(body, text='服务器地址').grid(row=2, column=0, sticky='w', padx=(0, 12))
        self.url_entry = ttk.Entry(body, textvariable=self.url)
        self.url_entry.grid(row=2, column=1, columnspan=2, sticky='ew', pady=6)
        ttk.Label(body, text='本地同步目录').grid(row=3, column=0, sticky='w')
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
        self.preview_button = ttk.Button(controls, text='查看变更预览', command=self.preview_deletions)
        for button in (self.start_button, self.pause_button, self.once_button, self.open_button, self.preview_button):
            button.pack(side='left', padx=(0, 8))
        self.reconcile_button = ttk.Button(body, text='重新对账', command=self.preview_reconciliation)
        self.reconcile_button.grid(row=14, column=0, sticky='w', pady=(8, 0))
        self.conflict_button = ttk.Button(body, text='处理选中冲突', command=self.open_conflict)
        self.conflict_button.grid(row=14, column=1, columnspan=2, sticky='w', pady=(8, 0))
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
        self.table.bind('<<TreeviewSelect>>', lambda _: self.update_controls(self.snapshot.get('root') is not None, self.phase in ('RUNNING', 'PAIRING', 'CONFIGURING')))
        pager = ttk.Frame(body)
        pager.grid(row=10, column=0, columnspan=3, sticky='e')
        self.previous_button = ttk.Button(pager, text='上一页', command=lambda: self.turn_page(-1))
        self.previous_button.pack(side='left')
        ttk.Label(pager, textvariable=self.page_label).pack(side='left', padx=10)
        self.next_button = ttk.Button(pager, text='下一页', command=lambda: self.turn_page(1))
        self.next_button.pack(side='left')
        ttk.Label(body, textvariable=self.state_label, wraplength=780).grid(row=11, column=0, columnspan=3, sticky='w', pady=(12, 0))
        ttk.Label(body, textvariable=self.scope_label, wraplength=780).grid(row=12, column=0, columnspan=3, sticky='w', pady=(8, 0))
        ttk.Label(body, textvariable=self.profile_label, wraplength=780).grid(row=13, column=0, columnspan=3, sticky='w', pady=(8, 0))
        def reflow(_):
            for child in body.winfo_children():
                if isinstance(child, ttk.Label) and float(child.cget('wraplength') or 0) > 0:
                    child.configure(wraplength=max(320, body.winfo_width() - 40))
        body.bind('<Configure>', reflow)
        self.render_items()
        self.update_controls(False, True)
        self.worker.start()
        self.poll_timer = self.window.after(100, self.poll)

    def choose(self):
        selected = filedialog.askdirectory(parent=self.window, title='选择同步目录（已有内容会先预检）', mustexist=True)
        if selected:
            self.directory.set(selected)

    def pair(self):
        if not self.url.get().strip() or not self.directory.get().strip() or not self.code.get().strip():
            self.status.set('填写服务器地址，选择同步目录，并输入网页生成的配对码。')
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
        busy = busy or self.reconfiguring
        selected = self.table.selection()
        path = self.table.item(selected[0], 'values')[0] if selected else None
        eligible = any(item['path'] == path for item in self.snapshot.get('result', {}).get('conflicts', []))
        self.conflict_button.configure(state='normal' if eligible and paired and not busy and not self.closing and not self.worker.stopped.is_set() else 'disabled')
        self.reconcile_button.configure(state='normal' if paired and not busy and not self.closing and not self.worker.stopped.is_set() else 'disabled')
        self.configure_button.configure(state='disabled' if busy or self.closing or self.worker.stopped.is_set() or not self.snapshot.get('profiles') else 'normal')
        for field in (self.url_entry, self.directory_entry, self.code_entry, self.choose_button, self.pair_button):
            field.configure(state='disabled' if paired or busy or self.closing else 'normal')
        for button in (self.start_button, self.once_button):
            button.configure(state='normal' if paired and not busy and not self.closing and not self.worker.stopped.is_set() else 'disabled')
        self.pause_button.configure(state='normal' if paired and not self.closing else 'disabled')
        self.open_button.configure(state='normal' if paired else 'disabled')
        preview = (self.snapshot.get('result', {}).get('deletionPreview') or self.snapshot.get('result', {}).get('initialMergePreview')
                   or self.snapshot.get('result', {}).get('reconciliationPreview'))
        self.preview_button.configure(state='normal' if preview and not busy and not self.closing else 'disabled')
        self.preview_button.configure(text='查看合并预检' if self.snapshot.get('result', {}).get('initialMergePreview') else '查看变更预览')
        if self.snapshot.get('result', {}).get('reconciliationPreview'):
            self.preview_button.configure(text='查看对账预检')

    def turn_page(self, offset: int):
        self.item_page += offset
        self.render_items()

    def preview_reconciliation(self):
        self.update_controls(True, True)
        self.worker.commands.put(ReconcilePreviewCommand())

    def open_conflict(self):
        selected = self.table.selection()
        if selected:
            self.update_controls(True, True)
            self.worker.commands.put(ConflictCommand(self.table.item(selected[0], 'values')[0]))

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
                if event.get('configurationFinished'):
                    self.reconfiguring = False
                    if not event['code']:
                        self.code.set('')
                paired = event['root'] is not None
                if paired:
                    self.directory.set(event['root']); self.url.set(event['url'])
                elif event.get('configurationFinished') and not event['code']:
                    self.directory.set('')
                text = PHASES[self.phase]
                if event['code']:
                    text += '。' + ERRORS.get(event['code'], '请检查待处理项并重试。') + ' [' + event['code'] + ']'
                self.state_label.set('状态目录：' + event.get('state', str(self.state)))
                active = next((item for item in event.get('profiles', []) if item['id'] == event.get('activeProfile')), None)
                self.profile_label.set('当前配置：' + active['name'] if active else '配置管理不可用，请检查状态目录。')
                if event.get('configurationFinished') and not event['code'] and active:
                    text = '已切换到“' + active['name'] + '”；' + text + '。需要手动开始同步。'
                self.status.set(text)
                result = event['result']
                if result.get('status') == 'CONFLICT_REVIEW' and self.phase == 'ATTENTION' and not event['code']:
                    from .conflict_dialog import ConflictDialog
                    if not self.conflict_dialog or not self.conflict_dialog.window.winfo_exists():
                        self.conflict_dialog = ConflictDialog(self, result['conflictPreview'])
                if result.get('status') == 'CONFLICT_RESOLVED' and not event['code']:
                    self.conflict_draft = None
                    self.status.set('此冲突已处理；原始副本、归档和回收副本保留，自动监听未开启。')
                if self.phase == 'ATTENTION' and result.get('reconciliationPreview'):
                    self.status.set('重新对账预检完成：点击“查看对账预检”核对并确认。确认前保留文件和旧任务；有歧义的删除不执行。' +
                                    (' 内容已变化，请核对新预检。' if event['code'] else ''))
                if result.get('status') == 'INITIAL_MERGE_REVIEW_REQUIRED':
                    self.status.set('首次合并待确认：点击“查看合并预检”，核对上传、下载、冲突和跳过项；确认前不传文件。' +
                                    (' 两端已变化，请重新核对。' if event['code'] == 'INITIAL_MERGE_CHANGED' else ''))
                if self.phase == 'ATTENTION' and not event['code'] and result.get('status') == 'REQUIRES_CONFIRMATION':
                    rename_review = any(item['direction'].startswith('rename-') for item in result['deletionPreview']['changes'])
                    self.status.set('文件改名待确认：请点击“查看变更预览”核对，确认后原文件 ID 和历史保持不变。' if rename_review
                                    else '删除操作待确认：请点击“查看变更预览”核对。确认前原文件保留。')
                scope = result.get('scope')
                if scope:
                    self.scope_label.set('同步范围：' + ('全部同步' if scope['all'] else '、'.join(scope['folders'])) + '；保留同名目录结构，请在对应目录内新建文件。引用附件自动纳入。')
                else:
                    self.scope_label.set('同步范围尚未核对；配对时在网页选择。')
                self.summary.set(f"最近核对：队列 {result.get('queued', 0)} 项，范围外暂存 {result.get('heldQueued', 0)} 项，冲突 {len(result.get('conflicts', []))} 项，问题 {len(result.get('issues', []))} 项。" if result else '尚未完成同步检查')
                if result.get('reconciliationArchives'):
                    self.summary.set(self.summary.get() + f" 本机保留 {result['reconciliationArchives']} 批对账归档，旧任务不自动重放。")
                if result.get('conflictReportCode'):
                    self.summary.set(self.summary.get() + ' 网页冲突状态未更新，元数据任务保留，下一次同步重试。[' + result['conflictReportCode'] + ']')
                self.items = [(item.get('path', ''), item.get('code', '')) for item in result.get('issues', [])]
                self.items += [(item['path'], '冲突：' + item['reason']) for item in result.get('conflicts', [])]
                self.items += [(item['path'], self.change_description(item)) for item in (result.get('deletionPreview') or {}).get('changes', [])]
                self.items += [(item['path'], self.merge_description(item)) for item in (result.get('initialMergePreview') or {}).get('changes', [])]
                self.items += [(item['path'], self.merge_description(item)) for item in (result.get('reconciliationPreview') or {}).get('changes', [])]
                self.render_items()
                self.update_controls(paired, self.phase in ('PAIRING', 'RUNNING', 'CONFIGURING'))
        except Empty:
            pass
        if self.closing and self.worker.stopped.is_set():
            self.window.destroy()
        else:
            self.poll_timer = self.window.after(100, self.poll)

    def manage_profiles(self):
        if self.configuration_dialog and self.configuration_dialog.winfo_exists():
            self.configuration_dialog.lift()
            return
        dialog = self.configuration_dialog = tk.Toplevel(self.window)
        dialog.title('更换服务器或本地目录'); dialog.transient(self.window); dialog.grab_set()
        dialog.geometry('760x560'); dialog.minsize(620, 500)
        frame = ttk.Frame(dialog, padding=16); frame.pack(fill='both', expand=True)
        ttk.Label(frame, text='新建独立配置后，可重新填写服务器和选择未绑定的目录；已有内容先预检。原配置、文件和待上传队列保留，可在这里切回；切换后默认暂停。', wraplength=700).pack(anchor='w', pady=(0, 12))
        self.profile_name = tk.StringVar()
        ttk.Label(frame, text='新配置名称').pack(anchor='w')
        entry = ttk.Entry(frame, textvariable=self.profile_name); entry.pack(fill='x', pady=(6, 8))
        actions = ttk.Frame(frame); actions.pack(fill='x', pady=(0, 12))
        def submit(*, identity=None, name=None):
            if name is not None and not 1 <= len(name.strip()) <= 80:
                self.profile_problem.set('请输入 1–80 个字符的配置名称。'); entry.focus_set(); return
            self.reconfiguring = True
            self.update_controls(self.snapshot.get('root') is not None, True)
            self.worker.change_profile(identity=identity, name=name)
            dialog.destroy()
        self.create_profile_button = ttk.Button(actions, text='新建配置并切换', command=lambda: submit(name=self.profile_name.get()))
        self.create_profile_button.pack(side='left')
        self.profile_problem = tk.StringVar()
        ttk.Label(frame, textvariable=self.profile_problem, wraplength=700).pack(anchor='w')
        ttk.Label(frame, text='已有配置（选择后点击切换，不会自动同步）').pack(anchor='w', pady=(8, 6))
        listing = ttk.Frame(frame); listing.pack(fill='both', expand=True)
        self.profile_table = ttk.Treeview(listing, columns=('name', 'server'), show='headings', height=6, selectmode='browse')
        self.profile_table.heading('name', text='配置名称'); self.profile_table.heading('server', text='服务器')
        self.profile_table.column('name', width=190, minwidth=140); self.profile_table.column('server', width=350, minwidth=200)
        self.profile_table.pack(side='left', fill='both', expand=True)
        scroll = ttk.Scrollbar(listing, orient='vertical', command=self.profile_table.yview)
        scroll.pack(side='right', fill='y'); self.profile_table.configure(yscrollcommand=scroll.set)
        selected_label = tk.StringVar()
        ttk.Label(frame, textvariable=selected_label, wraplength=700).pack(anchor='w', pady=8)
        profiles = self.snapshot.get('profiles', [])
        page = 0
        controls = ttk.Frame(frame); controls.pack(fill='x')
        page_label = ttk.Label(controls)
        def render(offset=0):
            nonlocal page
            count = max(1, (len(profiles) + 19) // 20)
            page = max(0, min(count - 1, page + offset))
            self.profile_table.delete(*self.profile_table.get_children())
            for item in profiles[page * 20:(page + 1) * 20]:
                self.profile_table.insert('', 'end', iid=item['id'], values=(item['name'] + ('（当前）' if item['id'] == self.snapshot.get('activeProfile') else ''), '配置无法读取' if item['error'] else item['url'] or '未配对'))
            previous.configure(state='normal' if page else 'disabled'); following.configure(state='normal' if page + 1 < count else 'disabled')
            page_label.configure(text=f'{page + 1} / {count} 页 · 每页 20 项')
            selected_label.set(''); switch.configure(state='disabled')
        def selected(_):
            identity = next(iter(self.profile_table.selection()), None)
            item = next((item for item in profiles if item['id'] == identity), None)
            selected_label.set('目录：' + (item['root'] or '尚未配对') if item else '')
            switch.configure(state='normal' if item and not item['error'] else 'disabled')
        self.profile_table.bind('<<TreeviewSelect>>', selected)
        previous = ttk.Button(controls, text='上一页', command=lambda: render(-1)); previous.pack(side='left')
        page_label.pack(side='left', padx=8)
        following = ttk.Button(controls, text='下一页', command=lambda: render(1)); following.pack(side='left')
        switch = self.switch_profile_button = ttk.Button(controls, text='使用选中配置', command=lambda: submit(identity=self.profile_table.selection()[0]), state='disabled')
        switch.pack(side='right', padx=(8, 0))
        ttk.Button(controls, text='关闭', command=dialog.destroy).pack(side='right')
        dialog.bind('<Escape>', lambda _: dialog.destroy())
        render(); entry.focus_set()

    def preview_deletions(self):
        if self.snapshot.get('result', {}).get('reconciliationPreview'):
            self.preview_initial_merge()
            return
        if self.snapshot.get('result', {}).get('initialMergePreview'):
            self.preview_initial_merge()
            return
        preview = self.snapshot.get('result', {}).get('deletionPreview')
        if not preview or self.deletion_dialog and self.deletion_dialog.winfo_exists():
            return
        dialog = self.deletion_dialog = tk.Toplevel(self.window)
        dialog.title('确认本批文件变更'); dialog.transient(self.window); dialog.grab_set()
        dialog.geometry('660x420'); dialog.minsize(520, 340)
        frame = ttk.Frame(dialog, padding=16); frame.pack(fill='both', expand=True)
        ttk.Label(frame, text=f"本轮拟变更 {len(preview['changes'])} 项。改名保留原文件 ID 和历史；删除保留回收副本。确认前核对方向和路径。", wraplength=620).pack(anchor='w', pady=(0, 12))
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
                content.insert('end', self.change_description(item) + '：' + item['path'] + '\n')
            content.configure(state='disabled'); label.configure(text=f'{page + 1} / {count} 页')
            previous.configure(state='normal' if page else 'disabled'); following.configure(state='normal' if page + 1 < count else 'disabled')
        previous = ttk.Button(controls, text='上一页', command=lambda: render(-1)); previous.pack(side='left')
        label.pack(side='left', padx=8)
        following = ttk.Button(controls, text='下一页', command=lambda: render(1)); following.pack(side='left')
        def confirm():
            dialog.destroy(); self.update_controls(True, True)
            self.worker.run_cycle(confirmation=preview['fingerprint'])
        ttk.Button(controls, text='取消', command=dialog.destroy).pack(side='right')
        ttk.Button(controls, text='确认本批变更', command=confirm).pack(side='right', padx=8)
        dialog.bind('<Escape>', lambda _: dialog.destroy())
        render()

    def preview_initial_merge(self):
        reconciliation = bool(self.snapshot.get('result', {}).get('reconciliationPreview'))
        preview = self.snapshot.get('result', {}).get('reconciliationPreview') if reconciliation else self.snapshot.get('result', {}).get('initialMergePreview')
        if not preview or self.merge_dialog and self.merge_dialog.winfo_exists():
            return
        dialog = self.merge_dialog = tk.Toplevel(self.window)
        dialog.title('重新对账预检' if reconciliation else '首次合并预检'); dialog.transient(self.window); dialog.grab_set()
        dialog.geometry('780x570'); dialog.minsize(640, 470)
        frame = ttk.Frame(dialog, padding=16); frame.pack(fill='both', expand=True)
        summary = preview['summary']
        ttk.Label(frame, text=f"上传 {summary.get('upload', 0) + summary.get('local-only', 0)} · 下载 {summary.get('download', 0)} · 内容一致 {summary.get('same', 0)} · 冲突 {summary.get('conflict', 0) + summary.get('deleted-conflict', 0) + summary.get('existing-conflict', 0)} · 跳过 {summary.get('skip', 0)}", wraplength=730).pack(anchor='w', pady=(0, 10))
        ttk.Label(frame, text='初始合并不推断删除。同名不同内容：服务器版本放回原路径，本地内容另存冲突副本；服务器已删除的路径保留本地内容并记录冲突。跳过项保留原状。取消后不执行本次合并。', wraplength=730).pack(anchor='w', pady=(0, 10))
        if reconciliation:
            ttk.Label(frame, text=f"无法确定的删除 {summary.get('uncertain-delete', 0)} · 旧任务 {summary.get('held-task', 0)}。确认后将旧任务与基线归档到本机状态库，不重放旧删除或改名；有歧义的内容列为冲突，等待后续处理。", wraplength=730).pack(anchor='w', pady=(0, 8))
        if not preview['canApply']:
            ttk.Label(frame, text='预检有待处理问题，请先处理下方问题并重新预检。' if reconciliation else '部分文件仍在变化，请等待保存完成后重新预检。', wraplength=730).pack(anchor='w', pady=(0, 8))
        listing = ttk.Frame(frame); listing.pack(fill='both', expand=True)
        text = tk.Text(listing, wrap='word', state='disabled', height=16)
        text.pack(side='left', fill='both', expand=True)
        scroll = ttk.Scrollbar(listing, orient='vertical', command=text.yview)
        scroll.pack(side='right', fill='y'); text.configure(yscrollcommand=scroll.set)
        controls = ttk.Frame(frame); controls.pack(fill='x', pady=(12, 0))
        page_label = ttk.Label(controls)
        page = 0
        def render(offset=0):
            nonlocal page
            count = max(1, (len(preview['changes']) + 19) // 20)
            page = max(0, min(count - 1, page + offset))
            text.configure(state='normal'); text.delete('1.0', 'end')
            for item in preview['changes'][page * 20:(page + 1) * 20]:
                details = (' · 本地摘要 ' + item['localSha256'][:12]) if item.get('localSha256') else ''
                if item.get('remoteVersion'):
                    details += ' · 服务器版本 ' + item['remoteVersion']
                text.insert('end', self.merge_description(item) + '：' + item['path'] + details + '\n\n')
            text.configure(state='disabled'); page_label.configure(text=f'{page + 1} / {count} 页 · 每页 20 项')
            previous.configure(state='normal' if page else 'disabled'); following.configure(state='normal' if page + 1 < count else 'disabled')
        previous = ttk.Button(controls, text='上一页', command=lambda: render(-1)); previous.pack(side='left')
        page_label.pack(side='left', padx=8)
        following = ttk.Button(controls, text='下一页', command=lambda: render(1)); following.pack(side='left')
        def apply():
            dialog.destroy(); self.update_controls(True, True)
            if reconciliation:
                self.worker.commands.put(ReconcilePreviewCommand(preview['fingerprint']))
            else:
                self.worker.run_cycle(initial_confirmation=preview['fingerprint'])
        def refresh():
            dialog.destroy()
            self.preview_reconciliation() if reconciliation else self.run()
        self.merge_confirm_button = ttk.Button(controls, text='确认并合并', command=apply,
            state='normal' if preview['canApply'] else 'disabled')
        self.merge_confirm_button.pack(side='right')
        cancel = self.merge_cancel_button = ttk.Button(controls, text='取消', command=dialog.destroy)
        cancel.pack(side='right', padx=8)
        ttk.Button(controls, text='重新预检', command=refresh).pack(side='right')
        dialog.bind('<Escape>', lambda _: dialog.destroy())
        render(); cancel.focus_set()

    @staticmethod
    def merge_description(item):
        labels = {'uncertain-delete': '旧记录对应路径已缺失，保留本地内容和记录，等待确认',
            'local-only': '仅本地存在，等待确认处理', 'held-task': '旧任务保留，本次不重放',
            'upload': '上传本地文件', 'download': '下载服务器文件', 'same': '内容一致，建立映射',
            'conflict': '保留双方，另存本地冲突副本', 'deleted-conflict': '删除记录冲突，保留本地内容',
            'existing-conflict': '已有待处理冲突，保留', 'keep-tombstone': '保留删除记录，不删除本地文件',
            'create-directory': '创建服务器目录结构', 'keep-directory': '保留已有目录（本地空目录不上传）',
            'queued': '恢复已确认的持久化任务', 'skip': '跳过并保留原状'}
        reasons = {'EXCLUDED_DIRECTORY': '配置或缓存目录，默认排除', 'EXCLUDED_FILE': '临时文件或配置文件，默认排除',
            'EXCLUDED_REMOTE': '服务器上的排除项，不下载', 'OUTSIDE_SYNC_SCOPE': '不在此设备选择的同步范围内',
            'FILE_TOO_LARGE': '超过单文件大小限制，请缩小文件后重试', 'INVALID_PATH': '文件名或路径不符合规则，请检查后重试',
            'FILE_BUSY': '文件仍在变化，请等待保存完成后重新预检',
            'INITIAL_PATH_CASE_CONFLICT': '两端路径大小写不同，Windows 无法分别保存，请先统一名称'}
        code = item.get('code')
        detail = (' · ' + reasons.get(code, ERRORS.get(code, code)) + ' [' + code + ']') if code else ''
        return labels.get(item['action'], item['action']) + detail

    @staticmethod
    def change_description(item):
        if item['direction'] == 'rename-remote':
            return '待确认服务器改名：' + item['source'] + ' → ' + item['path']
        if item['direction'] == 'rename-local':
            return '待确认本地改名：' + item['source'] + ' → ' + item['path']
        return '待确认删除服务器文件' if item['direction'] == 'remote' else '待确认移入本地回收副本'

    def close(self):
        if not self.closing:
            self.closing = True
            self.status.set('正在安全退出，等待当前文件操作完成；队列和草稿不会清除。')
            self.update_controls(self.snapshot.get('root') is not None, True)
            self.worker.close()


def run(state: Path):
    from .single_instance import SingleInstance, bind_activation
    instance = SingleInstance(state)
    try:
        if not instance.primary:
            return
        window = tk.Tk()
        SyncApp(window, state)
        bind_activation(window, instance)
        window.mainloop()
    finally:
        instance.close()
