<script setup lang="ts">
import { Menu as AMenu, MenuItem as AMenuItem } from 'ant-design-vue'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { MapAction, MapMenuItem } from './types'

const props = defineProps<{ x: number; y: number; items: MapMenuItem[]; anchor: HTMLElement }>()
const emit = defineEmits<{ close: []; action: [action: MapAction] }>()
const menu = ref<HTMLElement>(), left = ref(props.x), top = ref(props.y)
function close() { props.anchor.focus({ preventScroll: true }); emit('close') }
function choose(action: MapAction) { close(); emit('action', action) }
function outside(event: PointerEvent) { if (event.target instanceof Node && !menu.value?.contains(event.target)) close() }
function key(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); close() }
}
onMounted(async () => {
  await nextTick()
  const bounds = menu.value?.getBoundingClientRect()
  if (bounds) {
    left.value = Math.max(8, Math.min(props.x, innerWidth - bounds.width - 8))
    top.value = Math.max(8, Math.min(props.y, innerHeight - bounds.height - 8))
  }
  await nextTick()
  menu.value?.querySelector<HTMLElement>('[role=menuitem]:not(.ant-menu-item-disabled)')?.focus({ preventScroll: true })
  window.addEventListener('pointerdown', outside)
  window.addEventListener('resize', close)
})
onBeforeUnmount(() => { window.removeEventListener('pointerdown', outside); window.removeEventListener('resize', close) })
</script>
<template>
  <Teleport to="body"><div ref="menu" class="mindmap-context-menu" :style="{ left:left+'px',top:top+'px' }" @keydown="key" @contextmenu.prevent>
    <AMenu :selectable="false" aria-label="导图右键菜单"><AMenuItem v-for="item in items" :key="item.key" :disabled="item.disabled" :danger="item.danger" @click="choose(item.key)"><span class="mindmap-command"><span>{{ item.label }}</span><kbd v-if="item.shortcut">{{ item.shortcut }}</kbd></span></AMenuItem></AMenu>
  </div></Teleport>
</template>
<style scoped>
.mindmap-context-menu{position:fixed;z-index:1100;width:228px;max-width:calc(100vw - 16px);padding:5px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface);box-shadow:0 6px 24px #0002}.mindmap-context-menu :deep(.ant-menu){border:0!important}.mindmap-command{display:flex;align-items:center;justify-content:space-between;gap:16px}.mindmap-command kbd{font-size:11px;color:var(--color-text-muted);font-family:inherit;white-space:nowrap}.mindmap-context-menu :deep(.ant-menu-item){margin-inline:0;width:100%}
</style>
