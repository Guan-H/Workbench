<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import ExportFileTree from './ExportFileTree.vue'
import type { Note, TreeItem } from '../../shared/api/client'
const props = defineProps<{ items: Note[] }>()
const emit = defineEmits<{ close: []; exported: [] }>()
const panel = ref<HTMLElement>()
const previous = document.activeElement as HTMLElement
const selected = ref<string[]>([])
const busy = ref(false)
const error = ref('')
const query = ref('')
const rows = computed(() => props.items.filter(item => !item.deleted))
function selectAll() { selected.value = rows.value.map(item => item.id) }
function toggle(item: TreeItem) {
  const branch = rows.value.filter(row => row.id === item.id || item.type === 'folder' && row.path.startsWith(item.path + '/'))
  const remove = branch.every(row => selected.value.includes(row.id))
  const ids = new Set(selected.value)
  // Removing a child also removes recursive ancestor selections, preserving the other selected children.
  rows.value.filter(row => row.type === 'folder' && item.path.startsWith(row.path + '/')).forEach(row => ids.delete(row.id))
  branch.forEach(row => { if (remove) ids.delete(row.id); else ids.add(row.id) })
  selected.value = [...ids]
}
async function download() {
  if (!selected.value.length || busy.value) return
  busy.value = true; error.value = ''
  try {
    const response = await fetch('/api/v1/note-exports', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': (await (await fetch('/api/v1/auth/csrf')).json()).token }, body: JSON.stringify({ all: false, ids: selected.value }) })
    if (!response.ok) { const problem = await response.json().catch(() => ({})); throw new Error(problem.title ?? '导出失败，请重试。') }
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a'); link.href = url; link.download = 'private-space-notes.zip'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    emit('exported')
  } catch (cause) { error.value = cause instanceof TypeError ? '连接中断，未完成 ZIP 下载，请检查网络后重试。' : cause instanceof Error ? cause.message : '导出失败。' }
  finally { busy.value = false }
}
function close() { if (!busy.value) emit('close') }
function key(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape') close()
  if (event.key !== 'Tab') return
  const controls = [...panel.value!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')]
  if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
  else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
}
onMounted(async () => { await nextTick(); panel.value?.querySelector('button')?.focus() })
onBeforeUnmount(() => { if (previous?.isConnected) previous.focus() })
</script>
<template><div class="modal-backdrop"><section ref="panel" class="modal wide-modal export-dialog" role="dialog" aria-modal="true" aria-label="导出笔记" @keydown="key"><header><h2>选择导出内容</h2><button class="icon-button" title="关闭导出" aria-label="关闭导出" :disabled="busy" @click="close"><X :size="18" /></button></header><div class="export-body"><p class="field-help">导出服务器已保存的普通文件。勾选目录包含其全部子目录和文件；勾选单篇文档时，标准 Markdown 相对链接引用的库内附件一并打包。回收站、历史和本机未提交草稿不在导出范围。</p><div class="export-selection-actions"><button :disabled="busy || !rows.length" @click="selectAll">全选</button><button :disabled="busy || !selected.length" @click="selected = []">清空选择</button></div><label for="export-search">筛选路径</label><input id="export-search" v-model="query" :disabled="busy" /><p>已勾选 {{ selected.length }} 项（目录包含子项，不重复打包）</p><div class="export-list"><ExportFileTree :items="rows" :selected="selected" :query="query" :flat="!!query" :disabled="busy" @toggle="toggle" /><p v-if="!rows.some(item => item.path.includes(query))">暂无匹配内容</p></div><p v-if="error" class="error-message" role="alert">{{ error }}</p><p v-if="busy" role="status">正在生成并下载完整 ZIP，请稍候…</p></div><footer><button :disabled="busy" @click="close">取消</button><button class="primary" :disabled="busy || !selected.length" @click="download">确认导出</button></footer></section></div></template>
