<script setup lang="ts">
import { Button as AButton, Tree as ATree } from 'ant-design-vue'

import { computed, ref, watch } from 'vue'
import { ChevronRight, ChevronDown, Folder, FileText, Paperclip } from 'lucide-vue-next'
import type { Note } from '../../shared/api/client'
import { fileNodes } from './file-tree'

const props = withDefaults(defineProps<{ items: Note[]; selected?: string; revealPath?: string }>(), { selected: '', revealPath: '' })
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
const nodes = computed(() => fileNodes(props.items))
function toggle(id: string) { if (expanded.value.has(id)) expanded.value.delete(id); else expanded.value.add(id) }
watch(() => props.revealPath, () => {
  for (const note of props.items) {
    if (note.type === 'folder' && (props.revealPath === note.path || props.revealPath.startsWith(note.path + '/'))) expanded.value.add(note.id)
  }
}, { immediate: true })
</script>
<template>
  <ATree :expanded-keys="[...expanded]" :tree-data="nodes" :selectable="false" block-node class="workspace-tree" @expand="keys => expanded = new Set(keys.map(String))">
    <template #switcherIcon="{ dataRef: node }">
      <AButton type="text" class="tree-toggle" :aria-label="`${expanded.has(node.key) ? '收起' : '展开'}文件夹：${node.item.path}`" :title="`${expanded.has(node.key) ? '收起' : '展开'}文件夹：${node.item.path}`" :aria-expanded="expanded.has(node.key)" @click.stop="toggle(node.key)" @contextmenu="context($event, node.item)" @keydown="contextKey($event, node.item)"><component :is="expanded.has(node.key) ? ChevronDown : ChevronRight" :size="14" /></AButton>
    </template>
    <template #title="{ item: note }">
      <AButton type="text" class="tree-row" :class="{ selected: selected === note.id, 'drop-target': dropTarget === note.id }" :data-file-id="note.id" :data-file-path="note.path" :title="note.type === 'folder' ? `${note.path}（双击展开或收起）` : note.path" :aria-pressed="selected === note.id" :aria-expanded="note.type === 'folder' ? expanded.has(note.id) : undefined" aria-haspopup="menu"
        @click.stop="note.type === 'folder' ? emit('folder', note.path) : emit('open', note)" @dblclick.stop="note.type === 'folder' && toggle(note.id)" @contextmenu="context($event, note)" @keydown="contextKey($event, note)"
        draggable="true" @dragstart="drag($event, note)" @dragover="dragOver($event, note)" @drop="drop($event, note)" @dragleave="dropTarget = ''" @dragend="dropTarget = ''">
        <component :is="note.type === 'folder' ? Folder : note.type === 'note' ? FileText : Paperclip" :size="16" /><span>{{ note.path.split('/').at(-1) }}</span>
      </AButton>
    </template>
  </ATree>
</template>
