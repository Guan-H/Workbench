<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, ChevronDown, Folder, FileText, Paperclip } from 'lucide-vue-next'
import type { Note } from '../../shared/api/client'

const props = withDefaults(defineProps<{ items: Note[]; parent?: string; selected?: string; revealPath?: string; depth?: number }>(), { parent: '', depth: 0, selected: '', revealPath: '' })
const emit = defineEmits<{ open: [note: Note]; folder: [path: string]; context: [value: { note: Note; x: number; y: number; anchor: HTMLElement }]; move: [id: string, destination: string] }>()
const expanded = ref(new Set<string>())
const dropTarget = ref('')
function context(event: MouseEvent, note: Note) {
  event.preventDefault(); event.stopPropagation()
  const anchor = event.currentTarget as HTMLElement
  const bounds = anchor.getBoundingClientRect()
  emit('context', { note, x: event.clientX || bounds.left + 20, y: event.clientY || bounds.bottom, anchor })
}
function contextKey(event: KeyboardEvent, note: Note) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
  event.preventDefault(); event.stopPropagation()
  const anchor = event.currentTarget as HTMLElement
  const bounds = anchor.getBoundingClientRect()
  emit('context', { note, x: bounds.left + 20, y: bounds.bottom, anchor })
}
function drag(event: DragEvent, note: Note) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData('application/x-private-space-file', note.id)
  event.dataTransfer.effectAllowed = 'move'
}
function dragOver(event: DragEvent, note: Note) {
  if (note.type !== 'folder' || !event.dataTransfer?.types.includes('application/x-private-space-file')) return
  event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; dropTarget.value = note.id
}
function drop(event: DragEvent, note: Note) {
  if (note.type !== 'folder' || !event.dataTransfer?.types.includes('application/x-private-space-file')) return
  event.preventDefault(); event.stopPropagation(); dropTarget.value = ''; expanded.value.add(note.id)
  emit('move', event.dataTransfer.getData('application/x-private-space-file'), note.path)
}
const children = computed(() => props.items.filter((item) => item.path.split('/').slice(0, -1).join('/') === props.parent)
  .sort((a, b) => Number(b.type === 'folder') - Number(a.type === 'folder') || a.path.localeCompare(b.path, 'zh-CN')))
function toggle(id: string) { if (expanded.value.has(id)) expanded.value.delete(id); else expanded.value.add(id) }
watch(() => props.revealPath, () => {
  for (const note of children.value) {
    if (note.type === 'folder' && (props.revealPath === note.path || props.revealPath.startsWith(note.path + '/'))) expanded.value.add(note.id)
  }
}, { immediate: true })
</script>
<template>
  <ul class="file-tree">
    <li v-for="note in children" :key="note.id">
      <div class="tree-item" :style="{ paddingLeft: `${6 + depth * 16}px` }">
        <button v-if="note.type === 'folder'" class="tree-toggle" :aria-label="`${expanded.has(note.id) ? '收起' : '展开'}文件夹：${note.path}`" :title="`${expanded.has(note.id) ? '收起' : '展开'}文件夹：${note.path}`" :aria-expanded="expanded.has(note.id)" @click="toggle(note.id)" @contextmenu="context($event, note)" @keydown="contextKey($event, note)"><component :is="expanded.has(note.id) ? ChevronDown : ChevronRight" :size="14" /></button>
        <span v-else class="tree-toggle-space" />
      <button class="tree-row" :class="{ selected: selected === note.id, 'drop-target': dropTarget === note.id }" @click="note.type === 'folder' ? emit('folder', note.path) : emit('open', note)" @contextmenu="context($event, note)" @keydown="contextKey($event, note)" draggable="true" @dragstart="drag($event, note)" @dragover="dragOver($event, note)" @drop="drop($event, note)" @dragleave="dropTarget = ''" @dragend="dropTarget = ''" :data-file-id="note.id" :data-file-path="note.path" :title="note.path" :aria-pressed="selected === note.id" aria-haspopup="menu">
        <component :is="note.type === 'folder' ? Folder : note.type === 'note' ? FileText : Paperclip" :size="16" />
        <span>{{ note.path.split('/').at(-1) }}</span>
      </button>
      </div>
      <FileTree v-if="note.type === 'folder' && expanded.has(note.id)" :items="items" :parent="note.path" :depth="depth + 1" :selected="selected" :reveal-path="revealPath" @open="emit('open', $event)" @folder="emit('folder', $event)" @context="emit('context', $event)" @move="(id, destination) => emit('move', id, destination)" />
    </li>
  </ul>
</template>
