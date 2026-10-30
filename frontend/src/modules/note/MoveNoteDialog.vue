<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { X, FolderInput, Pencil } from 'lucide-vue-next'
import { api, write, ApiError, type Note, type MovePreview } from '../../shared/api/client'

const props = defineProps<{ note: Note; mode: 'rename' | 'move'; items: Note[]; destination?: string; draftIds: string[] }>()
const emit = defineEmits<{ close: []; moved: [note: Note] }>()
const dialog = ref<HTMLElement>()
const previousFocus = document.activeElement as HTMLElement
const name = ref(props.note.path.split('/').at(-1)!)
const folder = ref(props.destination ?? props.note.path.split('/').slice(0, -1).join('/'))
const target = computed(() => props.mode === 'rename'
  ? [...props.note.path.split('/').slice(0, -1), name.value].join('/')
  : (folder.value ? folder.value + '/' : '') + props.note.path.split('/').at(-1))
const destinations = computed(() => props.items.filter(item => item.type === 'folder' && !item.deleted && item.id !== props.note.id && !(props.note.type === 'folder' && item.path.toLowerCase().startsWith(props.note.path.toLowerCase() + '/'))).sort((a, b) => a.path.localeCompare(b.path, 'zh-CN')))
const preview = ref<MovePreview>()
const busy = ref(false)
const error = ref('')
const blockedDrafts = computed(() => preview.value?.changes.filter(change => props.draftIds.includes(change.id)) ?? [])
let operation = crypto.randomUUID()
function readableLink(value: string) { try { return decodeURIComponent(value) } catch { return value } }
watch(target, () => { preview.value = undefined; error.value = ''; operation = crypto.randomUUID() })

async function inspect() {
  busy.value = true; error.value = ''; preview.value = undefined
  try {
    if (props.mode === 'rename' && (name.value.includes('/') || name.value.includes('\\'))) throw new Error('名称不能包含目录分隔符，请使用“移动到”。')
    preview.value = await api<MovePreview>(`/notes/${props.note.id}/move-preview`, { method: 'POST', body: JSON.stringify({ targetPath: target.value, baseVersion: props.note.version }) })
    operation = crypto.randomUUID()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取变更预览失败，请重试。' }
  finally { busy.value = false }
}
async function commit() {
  if (!preview.value || blockedDrafts.value.length) return
  busy.value = true; error.value = ''
  try {
    const moved = await write<Note>(`/notes/${props.note.id}/move`, 'POST', { targetPath: target.value, baseVersion: props.note.version, fingerprint: preview.value.fingerprint }, operation)
    emit('moved', moved)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '移动未确认，请重试。'
    if (cause instanceof ApiError && cause.status === 409) preview.value = undefined
    // Unknown transport failure keeps the same operation, preview, and inputs for an idempotent retry.
  } finally { busy.value = false }
}
function close() { if (!busy.value) emit('close') }
function key(event: KeyboardEvent) {
  event.stopPropagation()
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault()
  if (event.key === 'Escape') { event.preventDefault(); close() }
  if (event.key !== 'Tab') return
  const controls = [...dialog.value!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
  if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
  else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
}
onMounted(async () => { await nextTick(); (dialog.value?.querySelector<HTMLElement>('input, select') ?? dialog.value?.querySelector('button'))?.focus(); if (props.destination !== undefined) void inspect() })
onBeforeUnmount(() => { if (previousFocus?.isConnected) previousFocus.focus(); else document.querySelector<HTMLElement>('[aria-label="刷新目录"]')?.focus() })
</script>
<template>
  <div class="modal-backdrop">
    <section ref="dialog" class="modal wide-modal move-dialog" role="dialog" aria-modal="true" :aria-label="mode === 'rename' ? '重命名文件' : '移动文件'" @keydown="key">
      <header><h2><component :is="mode === 'rename' ? Pencil : FolderInput" :size="18" />{{ mode === 'rename' ? '重命名' : '移动到目录' }}</h2><button class="icon-button" title="关闭对话框" aria-label="关闭对话框" :disabled="busy" @click="close"><X :size="18" /></button></header>
      <form @submit.prevent="inspect" class="move-form">
        <p class="move-path">原路径：{{ note.path }}</p>
        <template v-if="mode === 'rename'"><label for="move-name">新名称</label><input id="move-name" v-model="name" maxlength="240" required :disabled="busy" /></template>
        <template v-else><label for="move-folder">目标目录</label><select id="move-folder" v-model="folder" :disabled="busy"><option value="">根目录 /</option><option v-for="item in destinations" :key="item.id" :value="item.path">{{ item.path }}</option></select></template>
        <p class="field-help">目标：{{ target }}。同名内容不会被覆盖；确认前会预览目录和标准相对链接的变化。</p>
        <p v-if="error" class="error-message" role="alert">{{ error }}</p>
        <div v-if="preview" class="move-preview" tabindex="0">
          <h3>变更预览 · {{ preview.changes.length }} 个文件或目录</h3>
          <ul><li v-for="change in preview.changes" :key="change.id"><strong>{{ change.fromPath }}</strong><span v-if="change.toPath !== change.fromPath"> → {{ change.toPath }}</span><span v-else> · 更新引用</span><ul v-if="change.links.length"><li v-for="(link, index) in change.links" :key="index">第 {{ link.line }} 行：<code>{{ readableLink(link.from) }}</code> → <code>{{ readableLink(link.to) }}</code></li></ul></li></ul>
          <template v-if="preview.warnings.length"><h3>需要手动检查（不会自动改写）</h3><ul class="move-warnings"><li v-for="(warning, index) in preview.warnings" :key="index">{{ warning }}</li></ul></template>
          <p v-if="blockedDrafts.length" class="error-message">以下笔记有本机草稿，请先打开并保存后再操作：{{ blockedDrafts.map(change => change.fromPath).join('、') }}</p>
        </div>
        <footer><button type="button" :disabled="busy" @click="close">取消</button><button type="submit" :disabled="busy">{{ busy ? '正在处理…' : '预览变更' }}</button><button v-if="preview" class="primary" type="button" :disabled="busy || !!blockedDrafts.length" @click="commit">确认{{ mode === 'rename' ? '重命名' : '移动' }}</button></footer>
      </form>
    </section>
  </div>
</template>
