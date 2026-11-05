"""Paged conflict versions and an explicit Markdown merge editor."""

import base64
import difflib
import tkinter as tk
from tkinter import ttk
from .desktop_worker import ConflictCommand, ConflictDraftCommand


class ConflictDialog:
    def __init__(self, app, review):
        self.app, self.review = app, review
        dialog = self.window = tk.Toplevel(app.window)
        dialog.title('处理同步冲突'); dialog.transient(app.window); dialog.grab_set()
        dialog.geometry('820x650'); dialog.minsize(660, 520)
        frame = ttk.Frame(dialog, padding=16); frame.pack(fill='both', expand=True)
        ttk.Label(frame, text=review['path'], wraplength=760).pack(anchor='w')
        if review.get('rename'):
            ttk.Label(frame, text='原文件名：' + review['rename']['intent']['source'] + '\n处理后文件名：' + review['path'] + '\n由你选择采用哪份内容；助手会备份本地原文件，再完成改名和同步。', wraplength=760).pack(anchor='w', pady=6)
            choices = ttk.Frame(frame); choices.pack(fill='x', pady=6)
            self.use_server = ttk.Button(choices, text='以服务器为准', command=lambda: self.submit(variant='server')); self.use_server.pack(side='left')
            self.use_local = ttk.Button(choices, text='以本地内容为准', command=lambda: self.submit(variant='local'),
                state='normal' if any(item['id'] == 'local' for item in review['variants']) else 'disabled'); self.use_local.pack(side='left', padx=8)
        ttk.Label(frame, text='先查看版本，再明确采用。替换或删除原文件前会保存本机回收副本，原冲突副本和归档保留。采用本地版本可恢复服务器已删除的文件；已删除的父目录须先在网页恢复。', wraplength=760).pack(anchor='w', pady=10)
        listing = ttk.Frame(frame); listing.pack(fill='both', expand=True)
        self.table = ttk.Treeview(listing, columns=('label', 'size', 'sha'), show='headings', height=6)
        for key, label, width in (('label', '版本来源', 430), ('size', '字节数', 90), ('sha', '摘要', 150)):
            self.table.heading(key, text=label); self.table.column(key, width=width, minwidth=60)
        self.table.pack(side='left', fill='both', expand=True)
        scrollbar = ttk.Scrollbar(listing, command=self.table.yview); scrollbar.pack(side='right', fill='y'); self.table.configure(yscrollcommand=scrollbar.set)
        pager = ttk.Frame(frame); pager.pack(fill='x', pady=8)
        self.page, self.selected = 0, None
        previous = ttk.Button(pager, text='上一页', command=lambda: render(-1)); previous.pack(side='left')
        label = ttk.Label(pager); label.pack(side='left', padx=10)
        following = ttk.Button(pager, text='下一页', command=lambda: render(1)); following.pack(side='left')
        view = ttk.Panedwindow(frame, orient='horizontal'); view.pack(fill='both', expand=True)
        def pane(label):
            column = ttk.Frame(view); view.add(column, weight=1)
            ttk.Label(column, text=label).pack(anchor='w', pady=4)
            area = ttk.Frame(column); area.pack(fill='both', expand=True)
            text = tk.Text(area, wrap='word', height=10, width=30, state='disabled'); text.pack(side='left', fill='both', expand=True)
            scroll = ttk.Scrollbar(area, command=text.yview); scroll.pack(side='right', fill='y'); text.configure(yscrollcommand=scroll.set)
            text.tag_configure('difference', background='#fff1cf', foreground='#704413')
            return text
        self.server_content = pane('服务器当前版本')
        self.content = pane('所选版本（仅预览）')
        ttk.Label(frame, text='两栏各预览前 64 KiB，琥珀色标出文本差异；二进制显示片段。采用使用完整字节。', wraplength=760).pack(anchor='w', pady=6)
        actions = ttk.Frame(frame); actions.pack(fill='x', pady=8)
        self.adopt = ttk.Button(actions, text='采用所选版本', command=lambda: self.submit(variant=self.selected['id']), state='disabled'); self.adopt.pack(side='right')
        self.manual = ttk.Button(actions, text='手动合并 Markdown', command=self.edit, state='disabled'); self.manual.pack(side='right', padx=8)
        if review['pending']:
            ttk.Button(actions, text='继续上次处理', command=lambda: self.submit(resume=review['pending'])).pack(side='left')
        ttk.Button(actions, text='刷新版本', command=self.refresh).pack(side='left', padx=8)
        cancel = ttk.Button(actions, text='暂不处理', command=dialog.destroy); cancel.pack(side='right', padx=8)
        def render(offset=0):
            count = max(1, (len(review['variants']) + 19) // 20)
            self.page = max(0, min(count - 1, self.page + offset)); self.selected = None
            self.table.delete(*self.table.get_children()); self.adopt.configure(state='disabled'); self.manual.configure(state='disabled')
            for index in range(self.page * 20, min(len(review['variants']), (self.page + 1) * 20)):
                item = review['variants'][index]
                self.table.insert('', 'end', iid=str(index), values=(item['label'], item['size'], (item['sha256'] or '无内容')[:12]))
            label.configure(text=f'{self.page + 1} / {count} 页 · 每页 20 项')
            previous.configure(state='normal' if self.page else 'disabled'); following.configure(state='normal' if self.page + 1 < count else 'disabled')
        self.table.bind('<<TreeviewSelect>>', self.select); dialog.bind('<Escape>', lambda _: dialog.destroy())
        render(); cancel.focus_set()

    def select(self, _):
        selected = self.table.selection()
        if not selected:
            return
        self.selected = self.review['variants'][int(selected[0])]
        def display(widget, item):
            encoded = item['data']; data = base64.b64decode(encoded[:87380]) if encoded is not None else b''
            try:
                text = data.decode('utf-8'); textual = True
            except UnicodeError:
                text, textual = '二进制片段：\n' + data[:256].hex(' '), False
            if encoded is None:
                text = '此版本无文件内容。'
            widget.configure(state='normal'); widget.delete('1.0', 'end'); widget.insert('end', text); widget.configure(state='disabled')
            return text.splitlines(), textual
        server = next(item for item in self.review['variants'] if item['id'] == 'server')
        left, left_text = display(self.server_content, server)
        right, right_text = display(self.content, self.selected)
        if left_text and right_text:
            for kind, start, end, other_start, other_end in difflib.SequenceMatcher(None, left, right).get_opcodes():
                if kind != 'equal':
                    self.server_content.tag_add('difference', f'{start + 1}.0', f'{end + 1}.0')
                    self.content.tag_add('difference', f'{other_start + 1}.0', f'{other_end + 1}.0')
        encoded = self.selected['data']
        self.adopt.configure(state='normal'); self.manual.configure(state='normal' if self.review['path'].lower().endswith('.md') and encoded is not None else 'disabled')

    def submit(self, **choice):
        self.window.destroy(); self.app.update_controls(True, True)
        self.app.worker.commands.put(ConflictCommand(self.review['path'], self.review['fingerprint'], **choice))

    def refresh(self):
        self.window.destroy(); self.app.update_controls(True, True); self.app.worker.commands.put(ConflictCommand(self.review['path']))

    def edit(self):
        try:
            text = base64.b64decode(self.selected['data']).decode('utf-8')
        except (UnicodeError, TypeError):
            return
        if self.review.get('draft') is not None:
            text = self.review['draft']
        window = self.editor_window = tk.Toplevel(self.window)
        window.title('手动合并 Markdown'); window.transient(self.window); window.grab_set(); window.geometry('760x560')
        frame = ttk.Frame(window, padding=16); frame.pack(fill='both', expand=True)
        message = tk.StringVar(value='保存合并结果才提交服务器。关闭时保存本机草稿，重启后可继续；版本变化仍需重新核对。')
        ttk.Label(frame, textvariable=message, wraplength=700).pack(anchor='w', pady=8)
        listing = ttk.Frame(frame); listing.pack(fill='both', expand=True)
        self.editor = tk.Text(listing, wrap='word'); self.editor.pack(side='left', fill='both', expand=True); self.editor.insert('1.0', text)
        scroll = ttk.Scrollbar(listing, command=self.editor.yview); scroll.pack(side='right', fill='y'); self.editor.configure(yscrollcommand=scroll.set)
        def close():
            value = self.editor.get('1.0', 'end-1c')
            if len(value.encode('utf-8')) > 1024 * 1024:
                message.set('草稿超过 Markdown 1 MiB 限额，请缩小内容后再保存或关闭。'); return False
            self.review['draft'] = value
            self.app.worker.commands.put(ConflictDraftCommand(self.review['path'], value))
            window.destroy(); self.window.grab_set(); return True
        def save():
            value = self.editor.get('1.0', 'end-1c')
            if close(): self.submit(merged=value)
        self.close_editor = close
        controls = ttk.Frame(frame); controls.pack(fill='x', pady=12)
        self.save_merge = ttk.Button(controls, text='保存合并结果', command=save); self.save_merge.pack(side='right')
        self.close_merge = ttk.Button(controls, text='关闭并保存本机草稿', command=close); self.close_merge.pack(side='right', padx=8)
        ttk.Button(controls, text='放弃本次修改', command=lambda: (window.destroy(), self.window.grab_set())).pack(side='left')
        window.protocol('WM_DELETE_WINDOW', close); window.bind('<Escape>', lambda _: close())
