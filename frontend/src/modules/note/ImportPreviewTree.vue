<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, ChevronDown, Folder, FileText } from 'lucide-vue-next'
import type { ImportPreview } from '../../shared/api/client'

const props = withDefaults(defineProps<{ entries: ImportPreview['entries']; parent?: string; depth?: number }>(), { parent: '', depth: 0 })
const expanded = ref(new Set<string>())
const page = ref(1)
const folderPaths = computed(() => new Set(props.entries.filter(entry => entry.type === 'folder').map(entry => entry.path)))
const children = computed(() => props.entries.filter(entry => {
  const parent = entry.path.split('/').slice(0, -1).join('/')
  return (folderPaths.value.has(parent) ? parent : '') === props.parent
}).sort((a, b) => Number(b.type === 'folder') - Number(a.type === 'folder') || a.path.localeCompare(b.path, 'zh-CN')))
const pages = computed(() => Math.max(1, Math.ceil(children.value.length / 30)))
const visible = computed(() => children.value.slice((page.value - 1) * 30, page.value * 30))
watch(() => props.entries, () => { expanded.value.clear(); page.value = 1 })
function toggle(path: string) {
  if (expanded.value.has(path)) expanded.value.delete(path)
  else expanded.value.add(path)
}
function descendants(path: string) { return props.entries.filter(entry => entry.path.startsWith(path + '/')) }
function fileCount(path: string) { return descendants(path).filter(entry => entry.type !== 'folder').length }
function problems(path: string) { return descendants(path).filter(entry => entry.status === 'BLOCKED').length }
function size(bytes: number) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MiB' : (bytes / 1024).toFixed(1) + ' KiB' }
</script>
<template>
  <ul class="import-tree">
    <li v-for="(entry, index) in visible" :key="entry.path + index" :class="{ 'import-blocked': entry.status === 'BLOCKED' }">
      <button v-if="entry.type === 'folder'" class="import-tree-folder" :style="{ paddingLeft: `${depth * 16}px` }" :aria-expanded="expanded.has(entry.path)" :aria-label="`${expanded.has(entry.path) ? '收起' : '展开'}预检目录：${entry.path}`" @click="toggle(entry.path)">
        <component :is="expanded.has(entry.path) ? ChevronDown : ChevronRight" :size="15" aria-hidden="true" />
        <Folder :size="17" aria-hidden="true" />
        <span><strong>{{ entry.path.split('/').at(-1) }}</strong><small>{{ entry.message }} · {{ fileCount(entry.path) }} 个文件<span v-if="problems(entry.path)" class="import-blocked"> · 包含 {{ problems(entry.path) }} 项问题</span></small></span>
      </button>
      <div v-else class="import-tree-file" :style="{ paddingLeft: `${depth * 16 + 20}px` }">
        <FileText :size="16" aria-hidden="true" />
        <span><strong>{{ parent ? entry.path.split('/').at(-1) : entry.path }}</strong><small>{{ entry.message }} · {{ size(entry.size) }}</small></span>
      </div>
      <ImportPreviewTree v-if="entry.type === 'folder' && expanded.has(entry.path)" :entries="entries" :parent="entry.path" :depth="depth + 1" />
    </li>
    <li v-if="pages > 1"><nav class="pagination" :aria-label="`${parent || '根目录'}预检分页`"><button :disabled="page <= 1" @click="page--">上一页</button><span>{{ page }} / {{ pages }}</span><button :disabled="page >= pages" @click="page++">下一页</button></nav></li>
  </ul>
</template>
