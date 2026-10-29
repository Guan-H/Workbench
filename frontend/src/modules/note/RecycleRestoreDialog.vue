<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { X, RotateCcw, ListChecks } from 'lucide-vue-next'
import { api, write, ApiError, type Note, type TreeItem, type RecycleCandidates, type RecyclePreview, type RecycleRequest, type RecycleResult } from '../../shared/api/client'
import ExportFileTree from './ExportFileTree.vue'
import DirectoryPicker from './DirectoryPicker.vue'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'

const props = defineProps<{ note: Note; items: Note[] }>()
const emit = defineEmits<{ close: []; restored: [result: RecycleResult] }>()
const panel = ref<HTMLElement>()
const previous = document.activeElement as HTMLElement
const candidates = ref<RecycleCandidates>()
const step = ref<'mode' | 'files' | 'destination' | 'review'>('mode')
const mode = ref<'all' | 'files'>('files')
const destination = ref<'original' | 'directory'>('original')
const target = ref('')
const selected = ref<string[]>([])
const query = ref('')
const busy = ref(false)
const error = ref('')
const preview = ref<RecyclePreview>()
const reviewed = ref<RecycleRequest>()
const uncertain = ref(false)
const closing = ref(false)
const page = ref(1)
const leaves = computed(() => candidates.value?.items.filter(item => item.type !== 'folder') ?? [])
const fileIds = computed(() => selected.value.filter(id => leaves.value.some(item => item.id === id)).sort())
const parent = computed(() => candidates.value?.path.split('/').slice(0, -1).join('/') ?? '')
const pages = computed(() => Math.max(1, Math.ceil((preview.value?.changes.length ?? 0) / 20)))
const changes = computed(() => preview.value?.changes.slice((page.value - 1) * 20, page.value * 20) ?? [])
let operation = crypto.randomUUID()
function describe(cause: unknown) {
  return cause instanceof TypeError ? '连接中断，请检查网络和后端服务后重试。' : cause instanceof Error ? cause.message : '读取恢复信息失败，请重试。'
}

function toggle(item: TreeItem) {
  const branch = candidates.value!.items.filter(row => row.id === item.id || item.type === 'folder' && row.path.startsWith(item.path + '/'))
  const remove = branch.every(row => selected.value.includes(row.id))
  const ids = new Set(selected.value)
  candidates.value!.items.filter(row => row.type === 'folder' && item.path.startsWith(row.path + '/')).forEach(row => ids.delete(row.id))
  branch.forEach(row => { if (remove) ids.delete(row.id); else ids.add(row.id) })
  selected.value = [...ids]
}
async function inspect(all = false) {
  if (busy.value || uncertain.value || !candidates.value || !all && !fileIds.value.length) return
  if (all) { mode.value = 'all'; destination.value = 'original' }
  const request: RecycleRequest = { baseVersion: candidates.value.baseVersion, mode: mode.value, ids: all ? [] : fileIds.value, destination: destination.value, target: destination.value === 'directory' ? target.value : '' }
  busy.value = true; error.value = ''; preview.value = undefined
  try {
    preview.value = await api<RecyclePreview>(`/recycle/${props.note.id}/preview`, { method: 'POST', body: JSON.stringify(request) })
    reviewed.value = { ...request, fingerprint: preview.value.fingerprint }
    operation = crypto.randomUUID(); page.value = 1; step.value = 'review'
    await nextTick(); panel.value?.querySelector<HTMLElement>('.recycle-review')?.focus()
  } catch (cause) { error.value = describe(cause) }
  finally { busy.value = false }
}
async function commit() {
  if (!reviewed.value || busy.value) return
  busy.value = true; error.value = ''
  try { emit('restored', await write<RecycleResult>(`/recycle/${props.note.id}/restore`, 'POST', reviewed.value, operation)) }
  catch (cause) {
    uncertain.value = !(cause instanceof ApiError) || cause.status >= 500
    error.value = uncertain.value ? '恢复结果尚未确认，请保持本页并重试确认。' : (cause as Error).message
    if (!uncertain.value) { reviewed.value = undefined; preview.value = undefined; step.value = mode.value === 'all' ? 'mode' : 'destination' }
  } finally { busy.value = false }
}
function close() {
  if (busy.value) return
  if (uncertain.value) { closing.value = true; return }
  emit('close')
}
function key(event: KeyboardEvent) {
  event.stopPropagation()
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault()
  if (event.key === 'Escape') { event.preventDefault(); close() }
  if (event.key !== 'Tab') return
  const controls = [...panel.value!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
  if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
  else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
}
function unloading(event: BeforeUnloadEvent) { if (busy.value || uncertain.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(async () => {
  addEventListener('beforeunload', unloading)
  busy.value = true
  try { candidates.value = await api<RecycleCandidates>(`/recycle/${props.note.id}`) }
  catch (cause) { error.value = describe(cause) }
  finally { busy.value = false; await nextTick(); panel.value?.querySelector('button')?.focus() }
})
onBeforeUnmount(() => { removeEventListener('beforeunload', unloading); if (previous?.isConnected) previous.focus() })
</script>
<template>
  <div class="modal-backdrop">
    <section ref="panel" class="modal wide-modal recycle-dialog" role="dialog" aria-modal="true" aria-label="恢复回收站目录" @keydown="key">
      <header><h2>恢复回收站目录</h2><button class="icon-button" title="关闭恢复" aria-label="关闭恢复" :disabled="busy" @click="close"><X :size="18" /></button></header>
      <div class="recycle-body">
        <p>{{ candidates?.path || note.path }}</p>
        <p v-if="busy" role="status">正在读取或处理真实恢复数据，请稍候…</p>
        <p v-if="error" class="error-message" role="alert">{{ error }}</p>
        <template v-if="candidates && step === 'mode'">
          <p>选择恢复整个文件夹，或只恢复其中的文件。</p>
          <div class="recycle-mode"><button :disabled="busy" @click="inspect(true)"><RotateCcw :size="20" />恢复整个文件夹<small>仅恢复当前删除批次的剩余项目到原位置，已经恢复的项目不会再次恢复。</small></button><button :disabled="busy || !leaves.length" @click="mode = 'files'; step = 'files'"><ListChecks :size="20" />选择文件恢复<small>展开目录，多选文件，再选择恢复位置。</small></button></div>
        </template>
        <template v-if="step === 'files'">
          <label for="recycle-query">筛选待恢复文件</label><input id="recycle-query" v-model="query" :disabled="busy" />
          <div class="export-selection-actions"><button :disabled="busy" @click="selected = candidates!.items.map(item => item.id)">全选文件</button><button :disabled="busy" @click="selected = []">清空选择</button></div>
          <p>已选择 {{ fileIds.length }} 个文件</p>
          <div class="recycle-tree"><ExportFileTree :items="candidates!.items" :selected="selected" :parent="parent" :query="query" :flat="!!query" :disabled="busy" @toggle="toggle" /></div>
        </template>
        <template v-if="step === 'destination'">
          <p>已选择 {{ fileIds.length }} 个文件。恢复到哪里？</p>
          <div class="recycle-mode"><button :disabled="busy" @click="destination = 'original'; inspect()">恢复到原目录<small>保留原路径，仅补齐所选文件需要的目录。</small></button><button :class="{ active: destination === 'directory' }" :disabled="busy" @click="destination = 'directory'">恢复到指定目录<small>文件直接放入目标目录，不保留内部层级。</small></button></div>
          <template v-if="destination === 'directory'"><label for="recycle-target">指定目录</label><DirectoryPicker id="recycle-target" v-model="target" :items="items" :disabled="busy" title="选择恢复目标目录" /><button class="primary" :disabled="busy" @click="inspect()">预览恢复</button></template>
        </template>
        <div v-if="step === 'review' && preview" class="recycle-review" tabindex="0">
          <h3>恢复预览 · {{ preview.changes.length }} 个文件</h3>
          <ul><li v-for="change in changes" :key="change.id"><strong>{{ change.fromPath }}</strong><span>→ {{ change.toPath }}</span><small v-if="change.links.length">更新 {{ change.links.length }} 处标准相对链接</small></li></ul>
          <nav v-if="pages > 1" class="pagination" aria-label="恢复预览分页"><button :disabled="page <= 1 || busy" @click="page--">上一页</button><span>{{ page }} / {{ pages }}</span><button :disabled="page >= pages || busy" @click="page++">下一页</button></nav>
          <p class="field-help">补齐或恢复 {{ preview.folders.filter(folder => folder.action !== 'REUSE').length }} 个目录。遇到同名内容会阻止整批，不会覆盖。只有选中的文件会恢复；未选中的附件仍在回收站。更改位置时会更新能可靠解析的标准相对链接。</p>
          <ul v-if="preview.warnings.length" class="move-warnings"><li v-for="(warning, index) in preview.warnings" :key="index">{{ warning }}</li></ul>
        </div>
      </div>
      <footer><button :disabled="busy" @click="close">取消</button><button v-if="step !== 'mode' && !uncertain" :disabled="busy" @click="step = 'mode'; preview = undefined">重新选择范围</button><button v-if="step === 'files'" class="primary" :disabled="busy || !fileIds.length" @click="destination = 'original'; step = 'destination'">下一步：选择恢复位置</button><button v-if="step === 'review' && reviewed" class="primary" :disabled="busy" @click="commit">{{ uncertain ? '重试确认' : '确认恢复' }}</button></footer>
    </section>
    <ConfirmDialog v-if="closing" title="关闭恢复" message="恢复结果尚未确认，关闭后请先刷新回收站核对，避免重复发起。仍要关闭吗？" confirm-label="关闭恢复" @answer="value => { closing = false; if (value) emit('close') }" />
  </div>
</template>
