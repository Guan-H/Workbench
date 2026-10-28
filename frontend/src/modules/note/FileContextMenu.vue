<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { FolderInput, Pencil } from 'lucide-vue-next'
import type { Note } from '../../shared/api/client'

const props = defineProps<{ note: Note; x: number; y: number; anchor: HTMLElement }>()
const emit = defineEmits<{ close: []; action: [action: 'rename' | 'move'] }>()
const menu = ref<HTMLElement>()
const left = Math.max(8, Math.min(props.x, window.innerWidth - 200))
const top = Math.max(8, Math.min(props.y, window.innerHeight - 120))
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
onMounted(async () => { await nextTick(); menu.value?.querySelector('button')?.focus(); window.addEventListener('pointerdown', outside); window.addEventListener('resize', close); window.addEventListener('scroll', close, true) })
onBeforeUnmount(() => { window.removeEventListener('pointerdown', outside); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true) })
</script>
<template>
  <div ref="menu" role="menu" :aria-label="note.path + ' 的文件操作'" class="file-context-menu" :style="{ left: left + 'px', top: top + 'px' }" @keydown="key" @contextmenu.prevent>
    <button role="menuitem" @click="emit('action', 'rename')"><Pencil :size="16" />重命名</button>
    <button role="menuitem" @click="emit('action', 'move')"><FolderInput :size="16" />移动到…</button>
  </div>
</template>
