"""Paged conflict versions and an explicit Markdown merge editor."""

import base64
import tkinter as tk
from tkinter import ttk
from .desktop_worker import ConflictCommand


class ConflictDialog:
    def __init__(self, app, review):
        self.app, self.review = app, review
        dialog = self.window = tk.Toplevel(app.window)
        dialog.title('处理同步冲突'); dialog.transient(app.window); dialog.grab_set()
        dialog.geometry('820x650'); dialog.minsize(660, 520)
        frame = ttk.Frame(dialog, padding=16); frame.pack(fill='both', expand=True)
        ttk.Label(frame, text=review['path'], wraplength=760).pack(anchor='w')
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
        view = ttk.Frame(frame); view.pack(fill='both', expand=True)
        self.content = tk.Text(view, wrap='word', height=10, state='disabled'); self.content.pack(side='left', fill='both', expand=True)
        scroll = ttk.Scrollbar(view, command=self.content.yview); scroll.pack(side='right', fill='y'); self.content.configure(yscrollcommand=scroll.set)
        ttk.Label(frame, text='预览最多显示前 64 KiB；二进制显示十六进制片段。采用时使用完整字节。').pack(anchor='w', pady=6)
        actions = ttk.Frame(frame); actions.pack(fill='x', pady=8)
        self.adopt = ttk.Button(actions, text='采用所选版本', command=lambda: self.submit(variant=self.selected['id']), state='disabled'); self.adopt.pack(side='right')
        self.manual = ttk.Button(actions, text='手动合并 Markdown', command=self.edit, state='disabled'); self.manual.pack(side='right', padx=8)
        if review['pending']:
            ttk.Button(actions, text='继续上次处理', command=lambda: self.submit(resume=review['pending'])).pack(side='left')
        ttk.Button(actions, text='刷新版本', command=self.refresh).pack(side='left', padx=8)
        cancel = ttk.Button(actions, text='取消', command=dialog.destroy); cancel.pack(side='right', padx=8)
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
        encoded = self.selected['data']; data = base64.b64decode(encoded[:87380]) if encoded is not None else b''
        try:
            text = data.decode('utf-8')
        except UnicodeError:
            text = '二进制片段：\n' + data[:256].hex(' ')
        self.content.configure(state='normal'); self.content.delete('1.0', 'end'); self.content.insert('end', text); self.content.configure(state='disabled')
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
        if self.app.conflict_draft and self.app.conflict_draft[0] == self.review['path']:
            text = self.app.conflict_draft[1]
        window = self.editor_window = tk.Toplevel(self.window)
        window.title('手动合并 Markdown'); window.transient(self.window); window.grab_set(); window.geometry('760x560')
        frame = ttk.Frame(window, padding=16); frame.pack(fill='both', expand=True)
        ttk.Label(frame, text='点击保存才提交。版本过期会拒绝；本次编辑保留在当前助手内存中。', wraplength=700).pack(anchor='w', pady=8)
        listing = ttk.Frame(frame); listing.pack(fill='both', expand=True)
        self.editor = tk.Text(listing, wrap='word'); self.editor.pack(side='left', fill='both', expand=True); self.editor.insert('1.0', text)
        scroll = ttk.Scrollbar(listing, command=self.editor.yview); scroll.pack(side='right', fill='y'); self.editor.configure(yscrollcommand=scroll.set)
        def close():
            self.app.conflict_draft = (self.review['path'], self.editor.get('1.0', 'end-1c')); window.destroy(); self.window.grab_set()
        def save():
            value = self.editor.get('1.0', 'end-1c'); close(); self.submit(merged=value)
        controls = ttk.Frame(frame); controls.pack(fill='x', pady=12)
        self.save_merge = ttk.Button(controls, text='保存合并结果', command=save); self.save_merge.pack(side='right')
        ttk.Button(controls, text='关闭并保留本次编辑', command=close).pack(side='right', padx=8)
        window.protocol('WM_DELETE_WINDOW', close); window.bind('<Escape>', lambda _: close())
