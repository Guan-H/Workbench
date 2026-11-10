<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Form as AForm, FormItem as AFormItem, Input as AInput, Select as ASelect, Spin as ASpin } from 'ant-design-vue'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { api, write, type Note } from '../../shared/api/client'
import AppDialog from '../../shared/AppDialog.vue'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'
import AppMessage, { type Notice } from '../../shared/AppMessage.vue'
import PlainTextEditor from './PlainTextEditor.vue'
const PdfDocumentView = defineAsyncComponent(() => import('./PdfDocumentView.vue'))
const OfficeDocumentView = defineAsyncComponent(() => import('./OfficeDocumentView.vue'))
const props = defineProps<{ file: Note; username: string }>()
const emit = defineEmits<{ stored: [file: Note]; created: [file: Note] }>()
const file = ref(props.file), extension = computed(() => file.value.path.split('.').at(-1)?.toLowerCase())
const text = ref(''), original = ref(''), encoding = ref('auto'), bom = ref(false), busy = ref(false), loaded = ref(false), error = ref(''), notice = ref<Notice>()
const dirty = computed(() => text.value !== original.value), draftWarning = ref(''), conversion = ref(false), target = ref('')
const discard = ref(false)
const office = ref<{ save: () => Promise<boolean>; prepareLeave: () => Promise<boolean>; hasUnsaved: () => boolean; persistDraft: () => boolean }>()
const abort = new AbortController(), draftKey = `private-space:txt-draft:${props.username}:${props.file.id}`
let disposed = false, feedbackTimer: ReturnType<typeof setTimeout> | undefined
let pending: { operation: string; baseVersion: string; path: string; content: string; encoding: string; bom: boolean } | undefined
let saving: Promise<boolean> | undefined
function notify(message: string) { clearTimeout(feedbackTimer); notice.value = { kind: 'info', text: message }; feedbackTimer = setTimeout(() => { notice.value = undefined }, 2000) }
function persistDraft(): boolean {
  if (extension.value !== 'txt') return office.value?.persistDraft() ?? true
  try { if (dirty.value || pending) localStorage.setItem(draftKey, JSON.stringify({ content: text.value, baseVersion: file.value.version, encoding: encoding.value, bom: bom.value, pending })); else localStorage.removeItem(draftKey); return true }
  catch { draftWarning.value = '本机草稿暂存失败，请保存服务器或下载当前文本后再离开。'; return false }
}
function edit(value: string) { text.value = value; persistDraft() }
async function readText() {
  if (dirty.value) { error.value = '请先保存或下载当前草稿，再切换读取编码。'; return }
  busy.value = true; error.value = ''; loaded.value = false
  try {
    const result = await api<{ file: Note; content: string; encoding: string; bom: boolean }>(`/files/${file.value.id}/text?encoding=${encodeURIComponent(encoding.value)}`, { signal: abort.signal })
    if (disposed) return
    file.value = result.file; text.value = original.value = result.content; encoding.value = result.encoding; bom.value = result.bom; loaded.value = true
    const stored = localStorage.getItem(draftKey)
    if (stored) {
      const draft: unknown = JSON.parse(stored)
      if (draft && typeof draft === 'object' && 'content' in draft && typeof draft.content === 'string' && 'baseVersion' in draft && typeof draft.baseVersion === 'string') {
        text.value = draft.content
        draftWarning.value = draft.baseVersion === result.file.version ? '已恢复本机 TXT 草稿，尚未保存服务器。' : '草稿基线与服务器不同，请先下载草稿并核对；不会自动覆盖。'
        if (draft.baseVersion !== result.file.version) file.value = { ...file.value, version: draft.baseVersion }
        if ('encoding' in draft && typeof draft.encoding === 'string') encoding.value = draft.encoding
        if ('bom' in draft && typeof draft.bom === 'boolean') bom.value = draft.bom
        if ('pending' in draft && draft.pending && typeof draft.pending === 'object' && 'operation' in draft.pending && typeof draft.pending.operation === 'string'
          && 'baseVersion' in draft.pending && typeof draft.pending.baseVersion === 'string' && 'content' in draft.pending && typeof draft.pending.content === 'string'
          && 'path' in draft.pending && typeof draft.pending.path === 'string' && 'encoding' in draft.pending && typeof draft.pending.encoding === 'string' && 'bom' in draft.pending && typeof draft.pending.bom === 'boolean') {
          pending = { operation: draft.pending.operation, baseVersion: draft.pending.baseVersion, content: draft.pending.content, path: draft.pending.path, encoding: draft.pending.encoding, bom: draft.pending.bom }
        }
      }
    }
  } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : '文本读取失败。' }
  finally { if (!disposed) busy.value = false }
}
async function save(): Promise<boolean> {
  if (extension.value !== 'txt') return office.value?.save() ?? true
  if (saving) return saving
  if (!loaded.value) return false
  if (!dirty.value && !pending) { notify('没有未保存的修改。'); return true }
  busy.value = true; error.value = ''
  const task = (async () => {
    try {
      pending ??= { operation: crypto.randomUUID(), baseVersion: file.value.version, path: file.value.path, content: text.value, encoding: encoding.value, bom: bom.value }
      if (!persistDraft()) return false
      const request = pending
      const result = await write<Note>(`/files/${file.value.id}/text`, 'PUT', { baseVersion: request.baseVersion, path: request.path, content: request.content, encoding: request.encoding, bom: request.bom }, request.operation, abort.signal)
      if (disposed) return false
      file.value = result; original.value = request.content; pending = undefined; draftWarning.value = ''; persistDraft(); emit('stored', result); notify('TXT 文件已保存到服务器。'); return !dirty.value
    } catch (cause) { if (!disposed) { error.value = cause instanceof Error ? cause.message : '保存未能确认，请保留草稿并重试。'; persistDraft() }; return false }
    finally { if (!disposed) busy.value = false; saving = undefined }
  })()
  saving = task; return task
}
function downloadDraft() {
  const url = URL.createObjectURL(new Blob([text.value], { type: 'text/plain;charset=utf-8' })), link = document.createElement('a')
  link.href = url; link.download = file.value.path.split('/').at(-1) ?? 'draft.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function discardDraft(accepted: boolean) {
  discard.value = false
  if (!accepted) return
  try { localStorage.removeItem(draftKey); pending = undefined; text.value = original.value; draftWarning.value = ''; await readText() }
  catch { error.value = '无法清除本机草稿，原草稿保留，请先下载。' }
}
function openConversion() { target.value = file.value.path.replace(/\.(doc|xls)$/i, extension.value === 'doc' ? '.docx' : '.xlsx'); conversion.value = true }
async function convert() {
  busy.value = true; error.value = ''
  try {
    const created = await write<Note>('/documents/office/convert', 'POST', { id: file.value.id, baseVersion: file.value.version, target: target.value }, crypto.randomUUID(), abort.signal)
    if (disposed) return
    conversion.value = false; notify('转换文件已另存，原文件保留。'); emit('created', created)
  } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : '转换另存失败，原文件保留。' }
  finally { if (!disposed) busy.value = false }
}
function stored(value: Note) { file.value = value; emit('stored', value) }
onMounted(() => { if (extension.value === 'txt') void readText() })
onBeforeUnmount(() => { persistDraft(); disposed = true; abort.abort(); clearTimeout(feedbackTimer) })
defineExpose({ save, prepareLeave: async () => extension.value === 'txt' ? !dirty.value && !pending || await save() : await office.value?.prepareLeave() ?? true,
  hasUnsaved: () => dirty.value || !!pending || !!office.value?.hasUnsaved(), persistDraft })
</script>
<template>
  <section class="document-workspace" :aria-label="`${file.path} 文件工作区`" @keydown.ctrl.s.prevent.stop="save" @keydown.meta.s.prevent.stop="save">
    <header><strong>{{ file.path }}</strong><span>版本 {{ file.version }}</span><a :href="`/api/v1/files/content?path=${encodeURIComponent(file.path)}`" target="_blank" rel="noopener noreferrer">下载原文件</a></header>
    <AppMessage :notice="notice" @close="notice = undefined" />
    <AAlert v-if="error" type="error" show-icon :message="error" role="alert" />
    <AAlert v-if="draftWarning" type="warning" show-icon :message="draftWarning" />
    <template v-if="extension === 'txt'">
      <div class="document-actions"><label>读取编码 <ASelect v-model:value="encoding" :disabled="dirty || busy" :options="['auto','UTF-8','GB18030','UTF-16LE','UTF-16BE'].map(value => ({ value, label: value === 'auto' ? '自动（BOM / UTF-8）' : value }))" /></label><AButton :disabled="busy || dirty" @click="readText">重新读取</AButton><AButton :loading="busy" :disabled="!loaded" type="primary" @click="save">保存 TXT</AButton><AButton :disabled="!loaded" @click="downloadDraft">下载当前文本</AButton><AButton v-if="dirty || draftWarning" :disabled="busy" @click="discard = true">放弃草稿并重新读取</AButton><span>{{ dirty ? '有未保存修改' : '纯文本，不解析 Markdown' }}</span></div>
      <ASpin v-if="busy && !loaded" /><PlainTextEditor v-if="loaded" :key="`${file.id}:${encoding}`" :model-value="text" @update:model-value="edit" @save="save" />
    </template>
    <PdfDocumentView v-else-if="extension === 'pdf'" :id="file.id" :version="file.version" :name="file.path" />
    <OfficeDocumentView v-else-if="extension === 'docx' || extension === 'xlsx'" ref="office" :file="file" @stored="stored" @notice="notify" />
    <div v-else class="legacy-document"><h2>{{ extension === 'doc' ? '旧版 Word 文件' : '旧版 Excel 文件' }}</h2><p>转换为 {{ extension === 'doc' ? 'DOCX' : 'XLSX' }} 后另存并在线编辑，原文件保留。</p><AButton type="primary" @click="openConversion">转换并另存为新格式</AButton></div>
    <AppDialog v-if="conversion" label="转换并另存 Office 文件"><section class="modal"><header><h2>转换并另存</h2><AButton :disabled="busy" @click="conversion = false">关闭</AButton></header><AForm :model="{ target }" layout="vertical" @finish="convert"><p>原文件 {{ file.path }} 保留，目标路径若已存在则拒绝覆盖。</p><AFormItem label="另存路径"><AInput v-model:value="target" :disabled="busy" /></AFormItem><AAlert v-if="error" :message="error" type="error" /><footer><AButton type="primary" html-type="submit" :loading="busy">确认转换并另存</AButton></footer></AForm></section></AppDialog>
    <ConfirmDialog v-if="discard" message="确定放弃本机 TXT 草稿并重新读取服务器？请先下载需要保留的文本。此操作不会撤销服务器可能已完成的保存。" confirm-label="放弃本机草稿" @answer="discardDraft" />
  </section>
</template>
<style scoped>.document-workspace { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; } .document-workspace > header { display: flex; align-items: center; gap: 16px; padding: 12px 20px; border-bottom: 1px solid var(--color-border); flex-wrap: wrap; } header strong { overflow-wrap: anywhere; } .document-actions { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; padding: 12px; } .document-actions .ant-select { min-width: 170px; } .plain-text-editor { flex: 1; min-height: 0; } .legacy-document { padding: 32px; } .pdf-document-view, .office-document-view { flex: 1; min-height: 0; }</style>
