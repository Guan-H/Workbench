<script setup lang="ts">
import { Menu as AMenu, MenuItem as AMenuItem } from 'ant-design-vue'

import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { FolderInput, Pencil, Trash2, RotateCcw, FilePlus2, FolderPlus } from 'lucide-vue-next'
import type { Note } from '../../shared/api/client'

const props = withDefaults(defineProps<{ note?: Note; destination?: string; x: number; y: number; anchor: HTMLElement; trash?: boolean }>(), { trash: false, destination: '' })
const emit = defineEmits<{ close: []; action: [action: 'rename' | 'move' | 'delete' | 'restore' | 'new-note' | 'new-folder'] }>()
const menu = ref<HTMLElement>()
const left = ref(Math.max(8, Math.min(props.x, window.innerWidth - 200)))
const top = ref(Math.max(8, props.y))
let anchorPosition = { top: 0, left: 0, scrollTop: 0, scrollLeft: 0 }
function close() { props.anchor.focus(); emit('close') }
function key(event: KeyboardEvent) {
  event.stopPropagation()
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault()
  if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); close() }
}
function outside(event: PointerEvent) { if (!menu.value?.contains(event.target as Node)) close() }
function scrolled(event: Event) {
  if (menu.value?.contains(event.target as Node)) return
  const bounds = props.anchor.getBoundingClientRect()
  // Ignore a queued scroll event from revealing the row before the menu opened.
  if (bounds.top !== anchorPosition.top || bounds.left !== anchorPosition.left || props.anchor.scrollTop !== anchorPosition.scrollTop || props.anchor.scrollLeft !== anchorPosition.scrollLeft) close()
}
onMounted(async () => {
  await nextTick()
  const bounds = menu.value!.getBoundingClientRect()
  left.value = Math.max(8, Math.min(props.x, innerWidth - bounds.width - 8))
  top.value = Math.max(8, Math.min(props.y, innerHeight - bounds.height - 8))
  const anchorBounds = props.anchor.getBoundingClientRect()
  anchorPosition = { top: anchorBounds.top, left: anchorBounds.left, scrollTop: props.anchor.scrollTop, scrollLeft: props.anchor.scrollLeft }
  await nextTick()
  menu.value?.querySelector<HTMLElement>('[role=menuitem]')?.focus({ preventScroll: true })
  window.addEventListener('pointerdown', outside); window.addEventListener('resize', close); window.addEventListener('scroll', scrolled, true)
})
onBeforeUnmount(() => { window.removeEventListener('pointerdown', outside); window.removeEventListener('resize', close); window.removeEventListener('scroll', scrolled, true) })
</script>
<template>
  <div ref="menu" :aria-label="note ? note.path + ' 的文件操作' : (destination || '根目录 /') + ' 的新建操作'" class="file-context-menu" :style="{ left: left + 'px', top: top + 'px' }" @keydown="key" @contextmenu.prevent>
    <AMenu :selectable="false" aria-label="文件操作菜单">
    <AMenuItem key="restore" v-if="trash" @click="emit('action', 'restore')"><RotateCcw :size="16" />恢复</AMenuItem>
    <template v-else>
      <template v-if="!note || note.type === 'folder'">
        <p class="context-location" :title="note?.path || destination || '根目录 /'">新建位置：{{ note?.path || destination || '根目录 /' }}</p>
        <AMenuItem key="new-note" @click="emit('action', 'new-note')"><FilePlus2 :size="16" />{{ note ? '在此新建笔记' : '新建笔记' }}</AMenuItem>
        <AMenuItem key="new-folder" @click="emit('action', 'new-folder')"><FolderPlus :size="16" />{{ note ? '在此新建文件夹' : '新建文件夹' }}</AMenuItem>
      </template>
      <template v-if="note">
        <AMenuItem key="rename" @click="emit('action', 'rename')"><Pencil :size="16" />重命名</AMenuItem>
        <AMenuItem key="move" @click="emit('action', 'move')"><FolderInput :size="16" />移动到…</AMenuItem>
        <AMenuItem key="delete" danger class="danger-action" @click="emit('action', 'delete')"><Trash2 :size="16" />删除</AMenuItem>
      </template>
    </template>
    </AMenu>
  </div>
</template>
