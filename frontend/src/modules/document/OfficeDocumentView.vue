<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Checkbox as ACheckbox, Spin as ASpin } from 'ant-design-vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { api, write, type Note } from '../../shared/api/client'
interface OfficeStatus { state: 'OPEN' | 'CLOSED' | 'CONFLICT'; version: string; pendingSave: string | null; completedSave: string | null; errorCode: string | null; conflictId: string | null }
const props = defineProps<{ file: Note }>()
const emit = defineEmits<{ stored: [file: Note]; notice: [text: string]; changed: [dirty: boolean] }>()
const ready = ref(false), error = ref(''), busy = ref(false), conflictFile = ref<Note>()
const leaveAcknowledged = ref(false), edited = ref(false)
const host = ref<HTMLIFrameElement>(), hostUrl = ref(''), nonce = crypto.randomUUID()
let config: Record<string, unknown> | undefined
let session: string | undefined, disposed = false, dirty = false, changes = 0, timer: ReturnType<typeof setTimeout> | undefined
let saving: Promise<boolean> | undefined
let lastVersion = props.file.version
async function save(): Promise<boolean> {
  if (saving) return saving
  if (!session || !ready.value || disposed) return !dirty
  if (conflictFile.value) return false
  busy.value = true; error.value = ''
  const sequence = changes
  const task = (async () => {
    try {
      let request: { operation: string; accepted: boolean } | undefined
      for (let attempt = 0; attempt < 3; attempt++) {
        request = await write<{ operation: string; accepted: boolean }>(`/documents/office/sessions/${session}/save`, 'POST')
        if (disposed) return false
        if (request.accepted) break
        await new Promise(resolve => setTimeout(resolve, 800))
      }
      if (!request?.accepted) { if (dirty) throw new Error('文档服务尚未接收新的改动，请保留页面并稍后再保存。'); emit('notice', '没有待保存的新改动。'); return true }
      for (let attempt = 0; attempt < 45 && !disposed; attempt++) {
        const state = await api<OfficeStatus>(`/documents/office/sessions/${session}`)
        if (state.state === 'CONFLICT' && state.conflictId) {
          conflictFile.value = await api<Note>(`/notes/${state.conflictId}`)
          error.value = '原文件已被其他端修改。双方内容保留，当前编辑另存为下方冲突文件，请下载并核对。'; return false
        }
        if (state.errorCode) throw new Error('文档服务保存尚未完成，请保留页面并重试。')
        if (state.completedSave === request.operation) {
          if (state.version !== lastVersion) { lastVersion = state.version; emit('stored', await api<Note>(`/notes/${props.file.id}`)) }
          if (changes === sequence) { dirty = false; edited.value = false; emit('changed', false) }
          emit('notice', '文件已由服务器确认保存。'); return true
        }
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      throw new Error('保存结果尚待确认，请保留编辑页面，稍后重试核对。')
    } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : 'Office 保存失败。'; return false }
    finally { if (!disposed) { busy.value = false; if (dirty && changes !== sequence) timer = setTimeout(() => { void save() }, 1500) }; saving = undefined }
  })()
  saving = task; return task
}
function stateChanged(event: { data: boolean }) {
  if (disposed) return
  if (event.data) { changes++; dirty = true; edited.value = true; leaveAcknowledged.value = false; emit('changed', true) }
  clearTimeout(timer)
  if (dirty) timer = setTimeout(() => { void save() }, 1500)
}
function initializeHost() {
  if (!config || !hostUrl.value) return
  host.value?.contentWindow?.postMessage({ kind: 'init', config, nonce }, new URL(hostUrl.value).origin)
}
function hostMessage(event: MessageEvent<unknown>) {
  if (!hostUrl.value || event.source !== host.value?.contentWindow || event.origin !== new URL(hostUrl.value).origin) return
  const value = event.data
  if (!value || typeof value !== 'object' || !('nonce' in value) || value.nonce !== nonce || !('kind' in value)) return
  if (value.kind === 'host-ready') initializeHost()
  else if (value.kind === 'ready') ready.value = true
  else if (value.kind === 'save-requested') void save()
  else if (value.kind === 'changed' && 'data' in value && typeof value.data === 'boolean') stateChanged({ data: value.data })
  else if (value.kind === 'error') error.value = '文档编辑服务报告异常，请保留页面或下载原文件。'
}
onMounted(async () => {
  try {
    window.addEventListener('message', hostMessage)
    const opened = await write<{ id: string; hostUrl: string; config: Record<string, unknown> }>('/documents/office/sessions', 'POST', { id: props.file.id, baseVersion: props.file.version })
    if (disposed) return
    if (new URL(opened.hostUrl).origin === location.origin) throw new Error('文档服务必须使用独立来源，不能与保险库主页面共用来源。')
    session = opened.id; config = opened.config
    hostUrl.value = opened.hostUrl + '?parentOrigin=' + encodeURIComponent(location.origin) + '&nonce=' + encodeURIComponent(nonce)
  } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : 'Office 打开失败。' }
})
onBeforeUnmount(() => { disposed = true; clearTimeout(timer); window.removeEventListener('message', hostMessage); config = undefined })
defineExpose({ save, prepareLeave: async () => leaveAcknowledged.value || !dirty || await save(), hasUnsaved: () => dirty && !leaveAcknowledged.value, persistDraft: () => !dirty })
</script>
<template>
  <section class="office-document-view" aria-label="Office 在线编辑">
    <div class="office-toolbar"><AButton type="primary" :disabled="!ready || !!conflictFile" :loading="busy" @click="save">保存到服务器</AButton><span>{{ busy ? '等待文档服务和服务器确认…' : ready ? edited ? '有未确认保存的修改' : '编辑结果保存后进入文件历史和同步' : '正在连接文档服务…' }}</span></div>
    <AAlert v-if="error" type="error" show-icon :message="error" />
    <p v-if="conflictFile"><a :href="`/api/v1/files/content?path=${encodeURIComponent(conflictFile.path)}`" target="_blank" rel="noopener noreferrer">下载保留的冲突文件：{{ conflictFile.path }}</a></p>
    <p v-if="error && dirty"><ACheckbox v-model:checked="leaveAcknowledged">我已另行保管编辑结果，允许离开此编辑页面</ACheckbox></p>
    <ASpin v-if="!ready && !error" class="office-loading" /><div class="office-frame"><iframe v-if="hostUrl" ref="host" :src="hostUrl" title="隔离的 Office 文档编辑器" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals" referrerpolicy="no-referrer" @load="initializeHost" /></div>
  </section>
</template>
<style scoped>.office-document-view { height: 100%; min-height: 0; display: flex; flex-direction: column; } .office-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 12px; border-bottom: 1px solid var(--color-border); } .office-frame { flex: 1; min-height: 350px; } .office-frame > iframe { height: 100%; width: 100%; border: 0; } .office-loading { margin: 20px; } p { margin: 12px; overflow-wrap: anywhere; }</style>
