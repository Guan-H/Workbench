<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NotebookPen, FileText, FolderPlus, Plus, Search, Shield, RefreshCw, Trash2, Settings, LogOut,
  ChevronsLeft, PanelLeft, Columns2, Code2, Eye, Clock3, Star, Upload, X, ChevronRight, ListTree, Save,
  FilePlus2, Paperclip, Menu, RotateCcw } from 'lucide-vue-next'
import { diffLines } from 'diff'
import { api, write, listNotes, ApiError, type Note, type Revision } from '../../shared/api/client'
import MarkdownEditor from './MarkdownEditor.vue'
import FileTree from './FileTree.vue'
import FileContextMenu from './FileContextMenu.vue'
import MoveNoteDialog from './MoveNoteDialog.vue'
import { renderMarkdown } from './markdown'

const props = defineProps<{ username: string }>()
const emit = defineEmits<{ logout: [] }>()
const items = ref<Note[]>([])
const current = ref<Note>()
const text = ref('')
const savedText = ref('')
const status = ref('请选择或新建一篇笔记')
const problem = ref('')
const loading = ref(true)
const saving = ref(false)
const saveFeedback = ref<{ kind: 'saving' | 'success' | 'error' | 'info'; text: string }>()
const conflict = ref(false)
const view = ref<'notes' | 'favorites' | 'recent' | 'trash'>('notes')
const mode = ref<'split' | 'edit' | 'preview'>('split')
const splitPercent = ref(50)
const resizing = ref(false)
let resizePointer: number | undefined

function resizeSplit(event: PointerEvent) {
  if (resizePointer !== event.pointerId) return
  const bounds = (event.currentTarget as HTMLElement).parentElement!.getBoundingClientRect()
  splitPercent.value = Math.max(20, Math.min(80, Math.round((event.clientX - bounds.left - 4) / (bounds.width - 8) * 100)))
}
function startResize(event: PointerEvent) {
  if (event.button !== 0 || resizePointer !== undefined) return
  event.preventDefault()
  resizePointer = event.pointerId
  resizing.value = true
  const divider = event.currentTarget as HTMLElement
  divider.setPointerCapture(event.pointerId)
}
function endResize() { resizePointer = undefined; resizing.value = false }
function resizeKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  if (event.key === 'Home') splitPercent.value = 20
  else if (event.key === 'End') splitPercent.value = 80
  else splitPercent.value = Math.max(20, Math.min(80, splitPercent.value + (event.key === 'ArrowRight' ? 2 : -2)))
}
const query = ref('')
const searchResults = ref<Note[]>([])
const folder = ref('')
const treeVisible = ref(true)
const outlineVisible = ref(true)
const mobileNav = ref(false)
const modal = ref<'create' | 'history' | 'conflict' | null>(null)
const createType = ref<'note' | 'folder'>('note')
const createPath = ref('')
const modalBusy = ref(false)
const revisions = ref<Revision[]>([])
const historic = ref<Note>()
const serverCopy = ref<Note>()
const attachmentInput = ref<HTMLInputElement>()
const importInput = ref<HTMLInputElement>()
const previewArea = ref<HTMLElement>()
const contextMenu = ref<{ note: Note; x: number; y: number; anchor: HTMLElement }>()
const moveRequest = ref<{ note: Note; mode: 'rename' | 'move'; destination?: string; draftIds: string[] }>()
const rootDragOver = ref(false)
function resultContext(event: MouseEvent | KeyboardEvent, note: Note) {
  if (view.value === 'trash') return
  if (event instanceof KeyboardEvent && event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
  event.preventDefault(); event.stopPropagation()
  const anchor = event.currentTarget as HTMLElement
  const bounds = anchor.getBoundingClientRect()
  const mouse = event instanceof MouseEvent ? event : undefined
  contextMenu.value = { note, x: mouse?.clientX || bounds.left + 20, y: mouse?.clientY || bounds.bottom, anchor }
}

async function beginMove(note: Note, action: 'rename' | 'move', destination?: string) {
  contextMenu.value?.anchor.focus()
  contextMenu.value = undefined
  if (!await saveNow()) { problem.value = '请先保存或解决当前草稿冲突，再移动或重命名。'; return }
  persistDraft()
  await refresh()
  if (!await saveNow()) return
  persistDraft()
  const latest = items.value.find(item => item.id === note.id)
  if (!latest || latest.deleted) { problem.value = '文件已变化，请刷新目录后重试。'; return }
  const draftIds: string[] = []
  try { for (const item of items.value) if (localStorage.getItem(draftKey(item.id))) draftIds.push(item.id) }
  catch { problem.value = '无法检查本机草稿，暂未开始移动。'; return }
  moveRequest.value = { note: latest, mode: action, destination, draftIds }
}
function moveDropped(id: string, destination: string) {
  const note = items.value.find(item => item.id === id)
  if (!note) return
  if (note.type === 'folder' && (destination.toLowerCase() === note.path.toLowerCase() || destination.toLowerCase().startsWith(note.path.toLowerCase() + '/'))) {
    problem.value = '不能把文件夹移动到自身或子文件夹中。'; return
  }
  void beginMove(note, 'move', destination)
}
function rootDrop(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('application/x-private-space-file')) return
  event.preventDefault(); rootDragOver.value = false
  moveDropped(event.dataTransfer.getData('application/x-private-space-file'), '')
}
function rootOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('application/x-private-space-file')) return
  event.preventDefault(); event.dataTransfer.dropEffect = 'move'; rootDragOver.value = true
}
async function moved(note: Note) {
  moveRequest.value = undefined
  folder.value = note.path.split('/').slice(0, -1).join('/')
  await refresh()
  if (current.value) {
    try { applyNote(await api<Note>(`/notes/${current.value.id}`)) }
    catch (error) { problem.value = message(error) }
  }
  saveFeedback.value = { kind: 'success', text: '路径和可修复的相对链接已保存到服务器。' }
}
const dirty = computed(() => !!current.value && text.value !== savedText.value)
const preview = computed(() => current.value ? renderMarkdown(text.value, current.value.path) : '')
const outline = computed(() => {
  let fenced = false
  return text.value.split(/\r?\n/).flatMap((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return [] }
    const match = !fenced && /^(#{1,6})\s+(.+)$/.exec(line)
    return match ? [{ title: match[2]!, depth: match[1]!.length, line: index }] : []
  })
})
const visibleItems = computed(() => {
  const active = items.value.filter((item) => !item.deleted)
  if (view.value === 'favorites') return active.filter((item) => item.favorite)
  if (view.value === 'recent') return active.filter((item) => item.type === 'note' && item.lastOpenedAt)
    .sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? '')).slice(0, 20)
  return active
})
const currentTitle = computed(() => current.value?.path.split('/').at(-1) ?? '我的笔记')
const difference = computed(() => diffLines(serverCopy.value?.content ?? historic.value?.content ?? '', text.value))
type Pending = { id: string; path: string; content: string; baseVersion: string; operation: string }
let pending: Pending | undefined
let savePromise: Promise<boolean> | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let searchTimer: ReturnType<typeof setTimeout> | undefined
let querySerial = 0
let draftStored = true
let previousFocus: HTMLElement | null = null
watch(modal, async (value, previous) => {
  if (value && !previous) previousFocus = document.activeElement as HTMLElement
  await nextTick()
  if (value) document.querySelector<HTMLElement>('.modal input, .modal button')?.focus()
  else previousFocus?.focus()
})

function draftKey(id: string) { return `private-space:draft:${props.username}:${id}` }
function persistDraft() {
  if (!current.value) return
  try {
    if (dirty.value || pending) localStorage.setItem(draftKey(current.value.id), JSON.stringify({ text: text.value, baseVersion: current.value.version, pending }))
    else localStorage.removeItem(draftKey(current.value.id))
    draftStored = true
  } catch { draftStored = false; problem.value = '本机草稿暂存失败，请立即保存到服务器或下载草稿。' }
}

async function refresh() {
  try {
    items.value = await listNotes()
    if (query.value || view.value === 'trash') {
      const serial = ++querySerial
      const result = await listNotes(view.value === 'trash', query.value)
      if (serial === querySerial) searchResults.value = result
    }
    problem.value = ''
  }
  catch (error) { problem.value = message(error) }
  finally { loading.value = false }
}

function applyNote(note: Note) {
  saveFeedback.value = undefined
  current.value = note
  text.value = note.content ?? ''
  savedText.value = text.value
  pending = undefined
  conflict.value = false
  status.value = '服务器已保存'
  try {
    const cached = localStorage.getItem(draftKey(note.id))
    if (cached) {
      const draft = JSON.parse(cached) as { text: string; baseVersion: string; pending?: Pending }
      text.value = draft.text
      pending = draft.pending
      if (draft.baseVersion !== note.version && draft.text !== savedText.value) {
        conflict.value = true
        status.value = '本机草稿与服务器版本不同，等待处理'
      } else if (dirty.value || pending) status.value = '已恢复本机草稿，等待保存'
    }
  } catch { problem.value = '无法读取本机草稿，请保留当前内容后重试。' }
}

async function openNote(note: Note) {
  if (note.type === 'attachment') { window.open(`/api/v1/files/content?path=${encodeURIComponent(note.path)}`, '_blank', 'noopener,noreferrer'); return }
  if (note.type === 'folder' || note.id === current.value?.id) return
  if (!await leaveNote()) return
  problem.value = ''
  try { applyNote(await api<Note>(`/notes/${note.id}`)); mobileNav.value = false }
  catch (error) { problem.value = message(error) }
}

async function leaveNote() {
  if (!dirty.value && !pending) return true
  if (await saveNow()) return true
  persistDraft()
  return window.confirm(draftStored ? '未提交内容已暂存在本浏览器。仍要切换吗？' : '草稿暂存失败，切换可能丢失内容。仍要切换吗？')
}

async function saveNow(): Promise<boolean> {
  if (savePromise) return savePromise
  if (!current.value || current.value.deleted || current.value.type !== 'note') return true
  if (conflict.value) return false
  if (!dirty.value && !pending) { status.value = '服务器已保存'; return true }
  const task = (async () => {
    saving.value = true
    problem.value = ''
    try {
      while ((dirty.value || pending) && current.value) {
        const attempt: Pending = pending ?? { id: current.value.id, path: current.value.path, content: text.value,
          baseVersion: current.value.version, operation: crypto.randomUUID() }
        pending = attempt
        persistDraft()
        status.value = '正在保存…'
        const saved = await write<Note>(`/notes/${attempt.id}`, 'PUT', { path: attempt.path, type: 'note', content: attempt.content, baseVersion: attempt.baseVersion }, attempt.operation)
        current.value = saved
        savedText.value = attempt.content
        pending = undefined
        const index = items.value.findIndex((item) => item.id === saved.id)
        if (index >= 0) items.value[index] = saved
        persistDraft()
      }
      status.value = '服务器已保存'
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        conflict.value = true
        status.value = '存在冲突，双方版本已保留'
      } else status.value = '保存失败，本机草稿待提交'
      problem.value = message(error)
      persistDraft()
      return false
    } finally { saving.value = false }
  })()
  // Clear after assignment, even when the task finishes without an awaited write.
  // Clearing inside the async body can leave an already-resolved promise cached.
  savePromise = task
  try { return await task }
  finally { if (savePromise === task) savePromise = undefined }
}

async function manualSave() {
  window.clearTimeout(timer)
  if (!current.value || current.value.deleted || current.value.type !== 'note') {
    saveFeedback.value = { kind: 'info', text: '请先打开一篇可编辑的笔记。' }
    return
  }
  const hadChanges = dirty.value || !!pending || saving.value
  saveFeedback.value = { kind: 'saving', text: '正在保存到服务器…' }
  if (await saveNow()) {
    saveFeedback.value = hadChanges
      ? { kind: 'success', text: `已保存到服务器 · ${displayTime(new Date().toISOString())}` }
      : { kind: 'info', text: '当前没有未保存的修改。' }
  } else {
    saveFeedback.value = { kind: 'error', text: conflict.value
      ? '保存未完成：存在版本冲突，请对比并处理。'
      : `保存失败：${problem.value || '请检查连接后重试。'}` }
  }
}

function edit(value: string) {
  saveFeedback.value = undefined
  text.value = value
  persistDraft()
  status.value = conflict.value ? '存在冲突，当前编辑保留在本机' : '本机草稿已暂存'
  window.clearTimeout(timer)
  if (!conflict.value) timer = setTimeout(() => void saveNow(), 1000)
}

function openCreate(type: 'note' | 'folder') {
  createType.value = type
  createPath.value = (folder.value ? folder.value + '/' : '') + (type === 'note' ? '新建笔记.md' : '新建文件夹')
  modal.value = 'create'
}

async function create() {
  modalBusy.value = true
  problem.value = ''
  try {
    if (!await leaveNote()) return
    const note = await write<Note>('/notes', 'POST', { path: createPath.value, type: createType.value, content: '' })
    await refresh()
    if (note.type === 'note') applyNote(note)
    else folder.value = note.path
    modal.value = null
  } catch (error) { problem.value = message(error) }
  finally { modalBusy.value = false }
}

async function switchView(next: typeof view.value) {
  if (!await leaveNote()) return
  view.value = next
  query.value = ''
  mobileNav.value = false
  if (next === 'trash') {
    try { searchResults.value = await listNotes(true) } catch (error) { problem.value = message(error) }
  }
}

async function history(note = current.value) {
  if (!note) return
  if (note.id !== current.value?.id && !await leaveNote()) return
  if (note.id === current.value?.id && !await saveNow()) return
  if (note.id !== current.value?.id) applyNote(await api<Note>(`/notes/${note.id}`))
  modalBusy.value = true
  modal.value = 'history'
  historic.value = undefined
  try { revisions.value = await api<Revision[]>(`/notes/${note.id}/history`) }
  catch (error) { problem.value = message(error) }
  finally { modalBusy.value = false }
}

async function selectRevision(version: string) {
  if (!current.value) return
  try { historic.value = await api<Note>(`/notes/${current.value.id}/history/${version}`) }
  catch (error) { problem.value = message(error) }
}

async function restore() {
  if (!current.value || !historic.value || !window.confirm('恢复将创建一个新版本，已有历史继续保留。确认恢复？')) return
  modalBusy.value = true
  try {
    const restored = await write<Note>(`/notes/${current.value.id}/restore?version=${historic.value.version}&baseVersion=${current.value.version}`, 'POST')
    localStorage.removeItem(draftKey(restored.id))
    applyNote(restored)
    view.value = 'notes'
    modal.value = null
    await refresh()
  } catch (error) { problem.value = message(error) }
  finally { modalBusy.value = false }
}

async function removeCurrent() {
  if (!current.value || !await saveNow() || !window.confirm(`将“${currentTitle.value}”移入回收站？历史和附件仍将保留。`)) return
  try {
    await write(`/notes/${current.value.id}?baseVersion=${current.value.version}`, 'DELETE')
    localStorage.removeItem(draftKey(current.value.id))
    current.value = undefined
    text.value = ''; savedText.value = ''; status.value = '已移入回收站'
    await refresh()
  } catch (error) { problem.value = message(error) }
}

async function toggleFavorite() {
  if (!current.value) return
  try {
    await write(`/notes/${current.value.id}/favorite?value=${!current.value.favorite}`, 'PUT')
    current.value.favorite = !current.value.favorite
    await refresh()
  } catch (error) { problem.value = message(error) }
}

async function showConflict() {
  if (!current.value) return
  try { serverCopy.value = await api<Note>(`/notes/${current.value.id}`); modal.value = 'conflict' }
  catch (error) { problem.value = message(error) }
}

function resolveConflict(useServer: boolean) {
  if (!serverCopy.value || !current.value) return
  if (!window.confirm(useServer ? '采用服务器版本将放弃本机草稿。确认？' : '将以最新服务器版本为基线提交当前草稿。请先确认已在编辑区完成合并。')) return
  const local = text.value
  localStorage.removeItem(draftKey(current.value.id))
  applyNote(serverCopy.value)
  pending = undefined
  modal.value = null
  if (!useServer) edit(local)
}

async function upload(file: File) {
  if (!current.value || current.value.deleted) return
  if (file.size > 50 * 1024 * 1024) { problem.value = '附件最大 50 MiB。'; return }
  modalBusy.value = true
  try {
    const base = current.value.path.split('/').slice(0, -1).join('/')
    const assetFolder = (base ? base + '/' : '') + 'assets'
    if (!items.value.some((item) => item.path === assetFolder && item.type === 'folder')) {
      try { await write('/notes', 'POST', { path: assetFolder, type: 'folder', content: '' }) }
      catch (error) { if (!(error instanceof ApiError) || error.status !== 409) throw error }
    }
    const extension = file.name.includes('.') ? file.name.split('.').at(-1)!.toLowerCase().replace(/[^a-z0-9]/g, '') : 'bin'
    const name = `${crypto.randomUUID()}.${extension}`
    const form = new FormData()
    form.append('file', file)
    await api(`/files?path=${encodeURIComponent(assetFolder + '/' + name)}`, { method: 'POST', body: form, headers: { 'Idempotency-Key': crypto.randomUUID() } })
    const image = /^(png|jpg|jpeg|webp)$/.test(extension)
    const label = file.name.replace(/[\[\]\\]/g, '_')
    const newline = text.value.includes('\r\n') ? '\r\n' : '\n'
    edit(text.value + `${newline}${image ? '!' : ''}[${label}](assets/${name})${newline}`)
    await refresh()
  } catch (error) { problem.value = message(error) }
  finally { modalBusy.value = false }
}

async function imported(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    if (file.size > 1024 * 1024) throw new Error('Markdown 最大 1 MiB。')
    if (!await leaveNote() || !window.confirm(`将“${file.name}”导入当前文件夹？同名文件不会被覆盖。`)) return
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer())
    const note = await write<Note>('/notes', 'POST', { path: (folder.value ? folder.value + '/' : '') + file.name, type: 'note', content })
    await refresh(); applyNote(note)
  } catch (error) { problem.value = message(error) }
  finally { input.value = '' }
}

function downloadDraft() {
  const url = URL.createObjectURL(new Blob([text.value], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = currentTitle.value
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function logout() {
  if (!await leaveNote()) return
  if (dirty.value && !window.confirm('退出会保留本机普通笔记草稿，此电脑上的同一账户重新登录后可恢复。确认退出？')) return
  emit('logout')
}

function message(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试。' }
function displayTime(value?: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—' }
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || pending) { persistDraft(); event.preventDefault(); event.returnValue = '' } }
function shortcut(event: KeyboardEvent) {
  if (moveRequest.value || contextMenu.value) return
  if (modal.value && event.key === 'Tab') {
    const controls = [...document.querySelectorAll<HTMLElement>('.modal button:not(:disabled), .modal input, .modal [tabindex="0"]')]
    const first = controls[0]
    const last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    if (event.defaultPrevented) return
    event.preventDefault()
    if (!event.repeat && !modal.value) void manualSave()
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.getElementById('note-search')?.focus() }
  if (event.key === 'Escape') { modal.value = null; mobileNav.value = false }
}
function jumpHeading(index: number) { previewArea.value?.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({ behavior: 'auto', block: 'start' }) }
function previewClick(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-note-path]')
  if (!link) return
  event.preventDefault()
  const target = items.value.find((note) => note.path === link.dataset.notePath)
  if (target) void openNote(target)
  else problem.value = '链接指向的笔记不存在。'
}

watch(query, () => {
  window.clearTimeout(searchTimer)
  const serial = ++querySerial
  searchTimer = setTimeout(async () => {
    try { const result = await listNotes(view.value === 'trash', query.value); if (serial === querySerial) searchResults.value = result }
    catch (error) { if (serial === querySerial) problem.value = message(error) }
  }, 250)
})
onMounted(() => { void refresh(); window.addEventListener('beforeunload', beforeUnload); window.addEventListener('keydown', shortcut) })
onBeforeUnmount(() => { window.clearTimeout(timer); window.clearTimeout(searchTimer); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('keydown', shortcut) })
</script>

<template>
  <div class="workspace" :class="{ 'hide-tree': !treeVisible, 'hide-outline': !outlineVisible, 'mobile-nav-open': mobileNav }">
    <aside class="global-sidebar">
      <div class="brand"><span class="brand-mark"><NotebookPen :size="20" /></span><strong>私有空间</strong></div>
      <p class="nav-section-label">工作空间</p>
      <nav aria-label="主要导航">
        <button :class="{ active: view !== 'trash' }" @click="switchView('notes')"><FileText :size="18" />笔记</button>
        <button disabled title="M3 开放"><Shield :size="18" />密码保险库<span class="soon">待开放</span></button>
        <button disabled title="M2 开放"><RefreshCw :size="18" />同步中心<span class="soon">待开放</span></button>
        <button :class="{ active: view === 'trash' }" @click="switchView('trash')"><Trash2 :size="18" />回收站</button>
      </nav>
      <div class="sidebar-bottom"><button disabled><Settings :size="18" />设置<span class="soon">待开放</span></button><div class="account"><span class="avatar">{{ username.slice(0, 1).toUpperCase() }}</span><span>{{ username }}<small>个人空间</small></span><button class="icon-button" @click="logout" aria-label="退出登录" title="退出登录"><LogOut :size="16" /></button></div></div>
    </aside>

    <aside v-show="treeVisible" class="file-sidebar">
      <div class="file-sidebar-title"><strong>{{ view === 'trash' ? '回收站' : '我的笔记' }}</strong><button class="icon-button" title="收起文件树" aria-label="收起文件树" @click="treeVisible = false"><ChevronsLeft :size="17" /></button></div>
      <div class="search-field"><Search :size="16" /><input id="note-search" v-model="query" placeholder="搜索笔记…" aria-label="搜索笔记" /><kbd>⌘ K</kbd></div>
      <div class="file-actions"><button @click="openCreate('note')"><Plus :size="16" />新建笔记</button><button class="icon-button" @click="openCreate('folder')" title="新建文件夹" aria-label="新建文件夹"><FolderPlus :size="17" /></button></div>
      <div v-if="view !== 'trash' && !query" class="quick-filters"><button :class="{ active: view === 'favorites' }" @click="switchView('favorites')"><Star :size="14" />收藏</button><button :class="{ active: view === 'recent' }" @click="switchView('recent')"><Clock3 :size="14" />最近访问</button></div>
      <div class="tree-heading"><span>{{ query ? '搜索结果' : view === 'trash' ? '已删除的内容' : '文件目录' }}</span><button class="icon-button" @click="refresh" title="刷新目录" aria-label="刷新目录"><RefreshCw :size="13" /></button></div>
      <button v-if="view === 'notes' && !query" class="root-drop-target" :class="{ 'drop-target': rootDragOver }" @click="folder = ''" @dragover="rootOver" @dragleave="rootDragOver = false" @drop="rootDrop" title="点击切换根目录，或将文件拖到这里移回根目录">根目录 /</button>
      <div class="tree-scroll">
        <p v-if="loading" class="sidebar-empty" role="status">正在加载目录…</p>
        <template v-else-if="query || view !== 'notes'">
          <button v-for="note in (query || view === 'trash' ? searchResults : visibleItems)" :key="note.id" class="result-row" :data-file-path="note.path" @contextmenu="resultContext($event, note)" @keydown="resultContext($event, note)" :aria-haspopup="view !== 'trash' ? 'menu' : undefined" @click="view === 'trash' ? history(note) : openNote(note)"><FileText :size="16" /><span>{{ note.path }}</span></button>
          <p v-if="!(query || view === 'trash' ? searchResults : visibleItems).length" class="sidebar-empty">{{ view === 'trash' ? '回收站为空' : '暂无匹配的笔记' }}</p>
        </template>
        <template v-else><FileTree :items="items.filter(item => !item.deleted)" :selected="current?.id" @open="openNote" @folder="folder = $event" @context="contextMenu = $event" @move="moveDropped" /><p v-if="!items.length" class="sidebar-empty">还没有笔记，<br />从一个新的想法开始。</p></template>
      </div>
      <div class="import-area"><button @click="importInput?.click()"><Upload :size="15" />导入 Markdown</button><small v-if="folder">当前目录：{{ folder }} <button @click="folder = ''">回到根目录</button></small></div>
      <input ref="importInput" type="file" accept=".md" hidden @change="imported" />
    </aside>

    <main class="note-main">
      <header class="workspace-topbar"><div class="breadcrumb"><button class="icon-button mobile-menu" @click="mobileNav = !mobileNav" title="显示导航" aria-label="显示导航"><Menu :size="20" /></button><button v-if="!treeVisible" class="icon-button" @click="treeVisible = true" title="展开文件树" aria-label="展开文件树"><PanelLeft :size="18" /></button><span>我的笔记</span><ChevronRight :size="13" /><strong>{{ currentTitle }}</strong></div><span class="private-label"><Shield :size="13" />个人工作空间</span></header>
      <div v-if="problem" class="workspace-error" role="alert"><span>{{ problem }}</span><button class="icon-button" @click="problem = ''" title="关闭错误提示" aria-label="关闭错误提示"><X :size="15" /></button></div>
      <div v-if="saveFeedback" class="save-feedback" :class="'save-feedback-' + saveFeedback.kind" role="status" aria-live="polite" aria-atomic="true" data-testid="save-feedback"><Save :size="16" /><span>{{ saveFeedback.text }}</span><button class="icon-button" @click="saveFeedback = undefined" title="关闭保存提示" aria-label="关闭保存提示"><X :size="15" /></button></div>
      <template v-if="current && current.type === 'note' && !current.deleted">
        <div class="document-tab"><span><FileText :size="15" />{{ currentTitle }}<span v-if="dirty" class="unsaved-dot" title="有未提交修改" /></span></div>
        <div class="editor-toolbar"><div class="mode-switch" aria-label="编辑模式"><button :class="{ active: mode === 'split' }" @click="mode = 'split'"><Columns2 :size="14" />分栏</button><button :class="{ active: mode === 'edit' }" @click="mode = 'edit'"><Code2 :size="14" />编辑</button><button :class="{ active: mode === 'preview' }" @click="mode = 'preview'"><Eye :size="14" />预览</button></div><label v-if="mode === 'split'" class="split-width-control" title="点击滑轨调整编辑区宽度"><span>宽度</span><input v-model.number="splitPercent" type="range" min="20" max="80" aria-label="编辑区宽度" /></label><div class="editor-actions"><button class="icon-button" @click="toggleFavorite" :title="current.favorite ? '取消收藏' : '收藏笔记'" :aria-label="current.favorite ? '取消收藏' : '收藏笔记'" :class="{ starred: current.favorite }"><Star :size="17" /></button><button class="icon-button" @click="attachmentInput?.click()" title="上传附件" aria-label="上传附件" :disabled="modalBusy"><Paperclip :size="17" /></button><button title="查看笔记历史" @click="history()"><Clock3 :size="15" /><span>历史</span></button><button class="icon-button" @click="manualSave" title="保存笔记 (Ctrl+S)" aria-label="保存笔记" :disabled="saving"><Save :size="17" /></button><button class="icon-button" @click="removeCurrent" title="删除笔记" aria-label="删除笔记"><Trash2 :size="16" /></button><button class="icon-button" @click="outlineVisible = !outlineVisible" title="显示或隐藏大纲" aria-label="显示或隐藏大纲"><ListTree :size="17" /></button></div></div>
        <div v-if="conflict" class="conflict-bar"><span>检测到版本冲突，服务器与本机草稿均已保留。</span><button @click="showConflict">对比并处理</button><button @click="downloadDraft">下载本机草稿</button></div>
        <div class="editor-panels" :class="['mode-' + mode, { resizing }]" :style="{ '--split-ratio': splitPercent / 100 }" @dragover.prevent @drop.prevent="($event.dataTransfer?.files[0]) && upload($event.dataTransfer.files[0])" @paste.capture="($event.clipboardData?.files[0]) && ($event.preventDefault(), upload($event.clipboardData.files[0]))">
          <section v-show="mode !== 'preview'" class="source-panel" aria-label="Markdown 编辑区"><div class="panel-label">MARKDOWN</div><MarkdownEditor :key="current.id" :model-value="text" @update:model-value="edit" @save="manualSave" /></section>
          <div v-if="mode === 'split'" class="split-divider" role="separator" tabindex="0" aria-label="调整编辑区和预览区宽度" title="拖动调整宽度，双击恢复各半；方向键微调" aria-orientation="vertical" aria-valuemin="20" aria-valuemax="80" :aria-valuenow="splitPercent" :aria-valuetext="`编辑区 ${splitPercent}%，预览区 ${100 - splitPercent}%`" @pointerdown="startResize" @pointermove="resizeSplit" @pointerup="endResize" @pointercancel="endResize" @lostpointercapture="endResize" @keydown="resizeKey" @dblclick="splitPercent = 50" />
          <section v-show="mode !== 'edit'" class="preview-panel" aria-label="笔记预览"><div class="panel-label">预览</div><article ref="previewArea" class="markdown-preview" @click="previewClick" v-html="preview" /></section>
        </div>
      </template>
      <section v-else class="workspace-empty"><span class="empty-icon"><NotebookPen :size="38" stroke-width="1.25" /></span><p class="eyebrow">YOUR NOTES, YOUR SPACE</p><h1>{{ view === 'trash' ? '找回值得保留的记录' : '让每一个想法，都有归处' }}</h1><p>{{ view === 'trash' ? '从左侧选择已删除的笔记，查看历史并恢复。' : '新建一篇笔记，或导入已有的 Markdown 文件。' }}</p><button v-if="view !== 'trash'" class="primary" @click="openCreate('note')"><FilePlus2 :size="17" />写下第一篇笔记</button><p class="plaintext-note">普通笔记以明文保存，请勿在此记录密码或其他秘密。</p></section>
      <footer class="statusbar"><span role="status" aria-live="polite" :class="{ warning: conflict || dirty }"><span class="status-dot" />{{ status }}</span><span v-if="current">{{ text.length.toLocaleString() }} 字符<span class="status-separator">·</span>Markdown<span class="status-separator">·</span>UTF-8</span><span class="device-status">设备同步尚未启用</span></footer>
    </main>

    <aside v-if="outlineVisible && current && !current.deleted" class="outline-sidebar"><div><ListTree :size="15" /><strong>大纲</strong></div><button v-for="(heading, index) in outline" :key="heading.line" :style="{ paddingLeft: `${12 + (heading.depth - 1) * 10}px` }" @click="jumpHeading(index)">{{ heading.title }}</button><p v-if="!outline.length">使用标题组织你的笔记</p><p class="saved-time">服务器确认时间<br />{{ displayTime(current.updatedAt) }}</p></aside>

    <FileContextMenu v-if="contextMenu" v-bind="contextMenu" @close="contextMenu = undefined" @action="beginMove(contextMenu!.note, $event)" />
    <MoveNoteDialog v-if="moveRequest" v-bind="moveRequest" :items="items" @close="moveRequest = undefined" @moved="moved" />
    <input ref="attachmentInput" type="file" hidden @change="($event.target as HTMLInputElement).files?.[0] && upload(($event.target as HTMLInputElement).files![0]!)" />
    <div v-if="modal" class="modal-backdrop" @click.self="modal = null">
      <section class="modal" :class="{ 'wide-modal': modal !== 'create' }" role="dialog" aria-modal="true" :aria-label="modal === 'create' ? '新建内容' : modal === 'history' ? '笔记历史' : '处理冲突'">
        <header><h2>{{ modal === 'create' ? createType === 'note' ? '新建笔记' : '新建文件夹' : modal === 'history' ? '历史与恢复' : '对比并处理冲突' }}</h2><button class="icon-button" @click="modal = null" title="关闭对话框" aria-label="关闭对话框"><X :size="19" /></button></header>
        <form v-if="modal === 'create'" @submit.prevent="create"><label for="create-path">{{ createType === 'note' ? '笔记路径' : '文件夹路径' }}</label><input id="create-path" v-model="createPath" required autofocus /><p class="field-help">使用 / 分隔已有文件夹层级。同名内容不会被覆盖。</p><p v-if="problem" class="error-message">{{ problem }}</p><footer><button type="button" @click="modal = null">取消</button><button class="primary" :disabled="modalBusy">{{ modalBusy ? '创建中…' : '创建' }}</button></footer></form>
        <div v-else-if="modal === 'history'" class="history-layout"><div class="revision-list"><p v-if="modalBusy">正在读取历史…</p><button v-for="revision in revisions" :key="revision.version" :class="{ active: historic?.version === revision.version }" @click="selectRevision(revision.version)"><strong>版本 {{ revision.version }} {{ revision.deleted ? '· 删除记录' : '' }}</strong><small>{{ displayTime(revision.createdAt) }}</small></button></div><div class="history-detail"><template v-if="historic"><p>历史内容 · {{ historic.path }}</p><pre>{{ historic.content }}</pre><button class="primary" @click="restore" :disabled="historic.deleted || modalBusy"><RotateCcw :size="16" />恢复为新版本</button></template><p v-else>选择一个历史版本查看内容</p></div></div>
        <div v-else class="conflict-detail"><p>删除线为服务器内容，新增内容为本机草稿。可关闭对话框，在编辑区完成手动合并后再提交。</p><pre><template v-for="(part, index) in difference" :key="index"><span :class="{ 'diff-added': part.added, 'diff-removed': part.removed }">{{ part.value }}</span></template></pre><footer><button @click="resolveConflict(true)">采用服务器版本</button><button class="primary" @click="resolveConflict(false)">提交当前草稿（以最新版本为基线）</button></footer></div>
      </section>
    </div>
  </div>
</template>
