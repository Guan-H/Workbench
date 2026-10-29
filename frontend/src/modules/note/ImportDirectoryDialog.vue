<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import UploadProgressBar from '../../shared/UploadProgressBar.vue'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'
import ImportPreviewTree from './ImportPreviewTree.vue'
import DirectoryPicker from './DirectoryPicker.vue'
import { FolderInput, Upload, X, CheckCircle2 } from 'lucide-vue-next'
import { api, uploadRequest, ApiError, type UploadProgress, type Note, type ImportLimits, type ImportPreview, type ImportResult } from '../../shared/api/client'

const props = defineProps<{ items: Note[]; destination: string }>()
const emit = defineEmits<{ close: []; imported: [result: ImportResult] }>()
const dialog = ref<HTMLElement>()
const directoryInput = ref<HTMLInputElement>()
const filesInput = ref<HTMLInputElement>()
const previousFocus = document.activeElement as HTMLElement
const target = ref(props.destination)
const files = ref<File[]>([])
const selectedPaths = ref<string[]>([])
const scanning = ref(false)
const dragging = ref(false)
const excludedDirectories = ref(0)
const limits = ref<ImportLimits>()
const preview = ref<ImportPreview>()
const result = ref<ImportResult>()
const busy = ref(false)
const uploadProgress = ref<UploadProgress>()
const committing = ref(false)
const uncertain = ref(false)
const error = ref('')
const closing = ref(false)
const excluded = ref(0)
const paths = computed(() => selectedPaths.value)
const total = computed(() => files.value.reduce((sum, file) => sum + file.size, 0))
const problems = computed(() => {
  if (!limits.value) return []
  const issues: { path: string; message: string }[] = []
  if (files.value.length > limits.value.maxFiles) issues.push({ path: '本批文件', message: `最多 ${limits.value.maxFiles} 个文件，请拆分目录。` })
  if (total.value > limits.value.maxBytes) issues.push({ path: '本批文件', message: `总大小最多 ${size(limits.value.maxBytes)}，请拆分目录。` })
  files.value.forEach((file, index) => {
    const maximum = /\.md$/i.test(paths.value[index]!) ? limits.value!.maxNoteBytes : limits.value!.maxAttachmentBytes
    if (file.size > maximum) issues.push({ path: paths.value[index]!, message: `超过单文件限制 ${size(maximum)}。` })
  })
  return issues
})
let operation = crypto.randomUUID()
function size(bytes: number) { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB` }
watch(target, () => { preview.value = undefined; error.value = ''; operation = crypto.randomUUID() })
function selected(event: Event) {
  const chosen = Array.from((event.target as HTMLInputElement).files ?? [])
  choose(chosen.map(file => ({ file, path: file.webkitRelativePath || file.name })))
  ;(event.target as HTMLInputElement).value = ''
}
function choose(chosen: { file: File; path: string }[], skippedDirectories = 0) {
  const visible = chosen.filter(item => !item.path.split('/').slice(0, -1).some(segment => segment.startsWith('.')))
  files.value = visible.map(item => item.file)
  selectedPaths.value = visible.map(item => item.path)
  excluded.value = chosen.length - visible.length
  excludedDirectories.value = skippedDirectories
  preview.value = undefined; result.value = undefined; error.value = ''; operation = crypto.randomUUID()
}
async function dropped(event: DragEvent) {
  dragging.value = false
  if (busy.value || uncertain.value || scanning.value || !limits.value) return
  // Obtain entries synchronously while the drag data store is still accessible.
  const entries = Array.from(event.dataTransfer?.items ?? []).filter(item => item.kind === 'file')
    .map(item => typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null).filter((entry): entry is FileSystemEntry => !!entry)
  if (!entries.length) { error.value = '无法读取拖入内容，请拖入文件夹或使用“选择目录”按钮。'; return }
  scanning.value = true; error.value = ''; preview.value = undefined
  const chosen: { file: File; path: string }[] = []
  let skipped = 0
  let directories = 0
  let bytes = 0
  async function collect(entry: FileSystemEntry, parent: string) {
    const path = parent ? parent + '/' + entry.name : entry.name
    if (entry.isDirectory) {
      if (entry.name.startsWith('.')) { skipped++; return }
      if (++directories > 10000) throw new Error('目录层级或数量过多，请拆分后导入；尚未上传任何文件。')
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      while (true) {
        const children = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
        if (!children.length) break
        for (const child of children) await collect(child, path)
      }
    } else if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
      bytes += file.size
      if (chosen.length >= limits.value!.maxFiles || bytes > limits.value!.maxBytes) throw new Error('本批文件数量或总大小超过限制，请拆分后导入；尚未上传任何文件。')
      chosen.push({ file, path })
    }
  }
  try {
    for (const entry of entries) await collect(entry, '')
    choose(chosen, skipped)
    if (!chosen.length) error.value = '没有可导入文件。隐藏目录已排除；当前不导入空目录。'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取目录失败，请使用选择目录按钮重试。' }
  finally { scanning.value = false }
}
function form() {
  const data = new FormData()
  data.append('target', target.value)
  data.append('paths', JSON.stringify(paths.value))
  files.value.forEach(file => data.append('files', file, file.name))
  return data
}
async function inspect() {
  if (busy.value || scanning.value || !files.value.length || problems.value.length) return
  busy.value = true; error.value = ''; preview.value = undefined
  try {
    preview.value = await uploadRequest<ImportPreview>('/note-imports/preview', form(), value => { uploadProgress.value = value })
    operation = crypto.randomUUID()
    await nextTick()
    dialog.value?.querySelector<HTMLElement>('.import-preview')?.focus()
  } catch (cause) { error.value = cause instanceof TypeError ? '上传连接中断，未完成服务器预检。请检查后端和网络后重试；本批尚未导入。' : cause instanceof Error ? cause.message : '预检失败，请重试。' }
  finally { busy.value = false; uploadProgress.value = undefined }
}
async function commit() {
  if (!preview.value?.canImport || busy.value || scanning.value) return
  busy.value = true; committing.value = true; error.value = ''
  const data = form()
  data.append('fingerprint', preview.value.fingerprint)
  try {
    result.value = await uploadRequest<ImportResult>('/note-imports', data, value => { uploadProgress.value = value }, { 'Idempotency-Key': operation })
    uncertain.value = false
    emit('imported', result.value)
    await nextTick()
    dialog.value?.querySelector<HTMLElement>('.import-success')?.focus()
  } catch (cause) {
    if (cause instanceof ApiError) {
      error.value = cause.message
      if (cause.status === 409) preview.value = undefined
      // A server 5xx can also follow a committed transaction with a lost acknowledgement.
      uncertain.value = cause.status >= 500
    } else {
      uncertain.value = true
      error.value = '网络中断，尚未确认导入结果。请保持文件与目标不变，点击“重试确认”查询同一次操作。'
    }
  } finally { busy.value = false; committing.value = false; uploadProgress.value = undefined }
}
function close() {
  if (busy.value || scanning.value) return
  if (uncertain.value) { closing.value = true; return }
  emit('close')
}
function key(event: KeyboardEvent) {
  event.stopPropagation()
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault()
  if (event.key === 'Escape') { event.preventDefault(); close() }
  if (event.key !== 'Tab') return
  const controls = [...dialog.value!.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), [tabindex="0"]')]
  if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
  else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
}
function unloading(event: BeforeUnloadEvent) { if (committing.value || uncertain.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(async () => {
  addEventListener('beforeunload', unloading)
  await nextTick(); dialog.value?.querySelector('button')?.focus()
  try { limits.value = await api<ImportLimits>('/note-imports/limits') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '无法读取导入限制，请关闭后重试。' }
})
onBeforeUnmount(() => { removeEventListener('beforeunload', unloading); if (previousFocus?.isConnected) previousFocus.focus() })
</script>
<template>
  <div class="modal-backdrop">
    <section ref="dialog" class="modal wide-modal import-dialog" role="dialog" aria-modal="true" aria-label="批量导入目录" @keydown="key">
      <header><h2><FolderInput :size="19" aria-hidden="true" />批量导入目录</h2><button class="icon-button" title="关闭对话框" aria-label="关闭对话框" :disabled="busy || scanning" @click="close"><X :size="19" /></button></header>
      <div class="import-body">
        <template v-if="!result">
          <p class="field-help">选择 Markdown 目录及附件，保留所选目录名称和内部层级。已有目录可以合并，同名文件不会覆盖；发现问题时整批暂停。当前不导入空目录；以 . 开头的目录默认排除。</p>
          <label for="import-target">导入到</label><DirectoryPicker id="import-target" v-model="target" :items="items" :disabled="busy || scanning || uncertain" />
          <div class="import-pickers"><button :disabled="busy || scanning || uncertain || !limits" @click="directoryInput?.click()"><FolderInput :size="16" aria-hidden="true" />选择目录</button><button :disabled="busy || scanning || uncertain || !limits" @click="filesInput?.click()"><Upload :size="16" aria-hidden="true" />选择多个文件</button></div>
          <div class="directory-dropzone" :class="{ 'drag-active': dragging, 'drop-disabled': busy || scanning || uncertain }" role="region" aria-label="拖入目录" :aria-busy="scanning" @dragover.prevent.stop="dragging = !busy && !scanning && !uncertain" @dragleave.prevent="dragging = false" @drop.prevent.stop="dropped">
            <FolderInput :size="26" aria-hidden="true" />
            <strong>{{ scanning ? '正在读取目录…' : '将本机文件夹拖到这里' }}</strong>
            <small>只读取你主动拖入的内容，点击“重新预检”后才上传。也可使用上方“选择目录”按钮（系统窗口）。</small>
          </div>
          <input ref="directoryInput" type="file" webkitdirectory multiple hidden aria-label="选择导入目录" @change="selected" />
          <input ref="filesInput" type="file" multiple hidden aria-label="选择导入文件" @change="selected" />
          <p v-if="limits" class="field-help">每批最多 {{ limits.maxFiles }} 个文件、{{ size(limits.maxBytes) }}；Markdown {{ size(limits.maxNoteBytes) }} / 个，附件 {{ size(limits.maxAttachmentBytes) }} / 个。</p>
          <p v-if="excludedDirectories" class="field-help" role="status">已跳过 {{ excludedDirectories }} 个隐藏目录，其内容不会读取或上传。</p>
          <p v-if="excluded" class="field-help" role="status">已排除隐藏目录内 {{ excluded }} 个文件，不会上传。</p>
          <p v-if="files.length" role="status">已选择 {{ files.length }} 个文件 · {{ size(total) }}<span v-if="!preview"> · 尚未导入</span></p>
          <div v-if="problems.length" class="error-message" role="alert"><strong>本地大小检查未通过，尚未上传服务器</strong><ul><li v-for="(issue, index) in problems" :key="index">{{ issue.path }}：{{ issue.message }}</li></ul></div>
          <p v-if="error" class="error-message" role="alert">{{ error }}</p>
          <UploadProgressBar v-if="busy && uploadProgress" :progress="uploadProgress" :label="committing ? '导入上传' : '预检上传'" />
          <p v-if="busy" role="status">{{ committing ? '正在上传并发布本批文件，请保留当前页面…' : '正在上传并核对真实文件与服务器目录，尚未导入…' }}</p>
          <div v-if="preview" class="import-preview" tabindex="0" :aria-label="preview.canImport ? '导入预检通过' : '导入预检未通过'">
            <h3>{{ preview.canImport ? '预检通过，等待确认' : '预检未通过，未导入任何内容' }}</h3>
            <p class="field-help">{{ preview.fileCount }} 个文件 · {{ size(preview.totalBytes) }}。确认时会再次核对内容和目录版本。</p>
            <ImportPreviewTree :key="preview.fingerprint" :entries="preview.entries" />
          </div>
        </template>
        <div v-else class="import-success" role="status" tabindex="0"><CheckCircle2 :size="30" aria-hidden="true" /><h3>导入成功</h3><p>服务器已确认保存 {{ result.filesCreated }} 个文件，新建 {{ result.foldersCreated }} 个目录，共 {{ size(result.totalBytes) }}。</p><p class="field-help">关闭后可在文件树中展开目录查看。</p></div>
      </div>
      <footer><button :disabled="busy || scanning" @click="close">{{ result ? '完成' : '取消' }}</button><template v-if="!result"><button :disabled="busy || scanning || uncertain || !limits || !files.length || !!problems.length" @click="inspect">重新预检</button><button v-if="preview?.canImport" class="primary" :disabled="busy || scanning" @click="commit">{{ uncertain ? '重试确认' : '确认导入' }}</button></template></footer>
    </section>
    <ConfirmDialog v-if="closing" title="关闭导入" message="导入结果尚未确认，关闭后请先刷新目录核对，不要直接重新导入。仍要关闭吗？" confirm-label="关闭导入" @answer="value => { closing = false; if (value) emit('close') }" />
  </div>
</template>
