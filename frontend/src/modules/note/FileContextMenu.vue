<script setup lang="ts">
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
  const buttons = [...menu.value!.querySelectorAll<HTMLButtonElement>('button')]
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab', 'Escape'].includes(event.key)) event.preventDefault()
  if (event.key === 'Escape' || event.key === 'Tab') close()
  if (event.key === 'ArrowDown') buttons[(current + 1) % buttons.length]?.focus()
  if (event.key === 'ArrowUp') buttons[(current - 1 + buttons.length) % buttons.length]?.focus()
  if (event.key === 'Home') buttons[0]?.focus()
  if (event.key === 'End') buttons.at(-1)?.focus()
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
  menu.value?.querySelector('button')?.focus({ preventScroll: true })
  window.addEventListener('pointerdown', outside); window.addEventListener('resize', close); window.addEventListener('scroll', scrolled, true)
})
onBeforeUnmount(() => { window.removeEventListener('pointerdown', outside); window.removeEventListener('resize', close); window.removeEventListener('scroll', scrolled, true) })
</script>
<template>
  <div ref="menu" role="menu" :aria-label="note ? note.path + ' 的文件操作' : (destination || '根目录 /') + ' 的新建操作'" class="file-context-menu" :style="{ left: left + 'px', top: top + 'px' }" @keydown="key" @contextmenu.prevent>
    <button v-if="trash" role="menuitem" @click="emit('action', 'restore')"><RotateCcw :size="16" />恢复</button>
    <template v-else>
      <template v-if="!note || note.type === 'folder'">
        <p class="context-location" :title="note?.path || destination || '根目录 /'">新建位置：{{ note?.path || destination || '根目录 /' }}</p>
        <button role="menuitem" @click="emit('action', 'new-note')"><FilePlus2 :size="16" />{{ note ? '在此新建笔记' : '新建笔记' }}</button>
        <button role="menuitem" @click="emit('action', 'new-folder')"><FolderPlus :size="16" />{{ note ? '在此新建文件夹' : '新建文件夹' }}</button>
      </template>
      <template v-if="note">
        <button role="menuitem" @click="emit('action', 'rename')"><Pencil :size="16" />重命名</button>
        <button role="menuitem" @click="emit('action', 'move')"><FolderInput :size="16" />移动到…</button>
        <button role="menuitem" class="danger-action" @click="emit('action', 'delete')"><Trash2 :size="16" />删除</button>
      </template>
    </template>
  </div>
</template>
