<script setup lang="ts">
import { Button as AButton, Dropdown as ADropdown, Menu as AMenu, MenuItem as AMenuItem, Popover as APopover, Select as ASelect } from 'ant-design-vue'
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Crosshair, HelpCircle, Maximize, Minus, MoreHorizontal, Pencil, Plus, Redo2, Undo2 } from 'lucide-vue-next'
import MindElixir, { type NodeObj, type Topic } from 'mind-elixir'
import 'mind-elixir/style.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MindmapContextMenu from './MindmapContextMenu.vue'
import { parseMap, type MapAction, type MapDocument, type MapMenuItem, type MapNode } from './types'

const props = defineProps<{ document: MapDocument; disabled: boolean }>()
const emit = defineEmits<{ change: [document: MapDocument]; error: [text: string]; save: [] }>()
const host = ref<HTMLElement>(), frame = ref<HTMLElement>()
const single = ref(false), rootSelected = ref(true), hasChildren = ref(false), folded = ref(false)
const direction = ref(props.document.direction), zoom = ref(100), undoDepth = ref(0), redoDepth = ref(0)
const floating = ref<{ left: number; top: number }>()
const context = ref<{ x: number; y: number; node: boolean }>()
let mind: MindElixir | undefined, baseline = JSON.stringify(props.document), editing = false
let resize: ResizeObserver | undefined, resizeFrame = 0, positionFrame = 0
const count = computed(() => {
  const total = (item: MapNode): number => 1 + item.children.reduce((sum, child) => sum + total(child), 0)
  return total(props.document.nodeData)
})
const menuItems = computed<MapMenuItem[]>(() => context.value?.node ? [
  { key: 'child', label: '插入子节点', shortcut: 'Tab', disabled: props.disabled },
  { key: 'sibling', label: '插入同级节点', shortcut: 'Enter', disabled: props.disabled || rootSelected.value },
  { key: 'parent', label: '插入父节点', shortcut: 'Ctrl+Enter', disabled: props.disabled || rootSelected.value },
  { key: 'edit', label: '编辑节点文字', shortcut: 'F2', disabled: props.disabled },
  { key: 'fold', label: rootSelected.value ? (folded.value ? '展开全部分支' : '收起全部分支') : (folded.value ? '展开分支' : '折叠分支'), disabled: props.disabled || !hasChildren.value },
  { key: 'delete', label: '删除节点', shortcut: 'Delete', danger: true, disabled: props.disabled || rootSelected.value },
] : [
  { key: 'root-child', label: '添加主分支', disabled: props.disabled },
  { key: 'expand-all', label: '展开全部分支', disabled: props.disabled },
  { key: 'collapse-all', label: '收起全部分支', disabled: props.disabled },
  { key: 'fit', label: '适应画布' }, { key: 'center', label: '回到中心主题' }, { key: 'reset', label: '恢复 100% 缩放' },
])

function node(value: NodeObj): MapNode {
  return { id: value.id, topic: value.topic, children: (value.children ?? []).map(node),
    ...(value.expanded === undefined ? {} : { expanded: value.expanded }), ...(value.direction === undefined ? {} : { direction: value.direction }) }
}
function position() {
  cancelAnimationFrame(positionFrame)
  positionFrame = requestAnimationFrame(() => {
    editing = !!host.value?.querySelector('#input-box')
    const topic = mind?.currentNode, bounds = frame.value?.getBoundingClientRect()
    if (!topic || !bounds || !single.value || editing || props.disabled || context.value || !topic.isConnected) { floating.value = undefined; return }
    const target = topic.getBoundingClientRect()
    if (target.right < bounds.left || target.left > bounds.right || target.bottom < bounds.top || target.top > bounds.bottom) { floating.value = undefined; return }
    const width = Math.min(matchMedia('(max-width:600px)').matches ? 176 : 152, bounds.width - 16)
    floating.value = {
      left: Math.max(8, Math.min(target.left + target.width / 2 - bounds.left - width / 2, bounds.width - width - 8)),
      top: Math.max(8, Math.min(target.top - bounds.top > 56 ? target.top - bounds.top - 50 : target.bottom - bounds.top + 10, bounds.height - 54)),
    }
  })
}
function isFolded(value: NodeObj | undefined) {
  if (!value) return false
  if (value.id === mind?.nodeData.id) return !!value.children?.length && value.children.every(child => child.expanded === false)
  return value.expanded === false
}
function selection() {
  const topics = mind?.currentNodes.filter(topic => topic.isConnected) ?? []
  single.value = topics.length === 1
  rootSelected.value = !topics.length || topics.some(topic => topic.nodeObj.id === mind?.nodeData.id)
  hasChildren.value = !!mind?.currentNode?.nodeObj.children?.length
  folded.value = isFolded(mind?.currentNode?.nodeObj)
  position()
}
function changed() {
  if (!mind) return
  try {
    const data = mind.getData()
    const value = parseMap({ format: 'workbench-mindmap', schemaVersion: 1, direction: data.direction ?? 2, nodeData: node(data.nodeData) })
    baseline = JSON.stringify(value); direction.value = value.direction; emit('change', value)
  } catch (cause) { emit('error', cause instanceof Error ? cause.message : '导图内容无法保存，请撤销本次修改。') }
}
function fit() {
  cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    if (host.value?.clientWidth && host.value.clientHeight) mind?.scaleFit()
    selection()
  })
}
function currentTopic(): Topic | undefined {
  if (!mind) return
  const topic = mind.currentNode
  if (topic?.isConnected) return topic
  const root = mind.findEle(mind.nodeData.id); mind.selectNode(root); return root
}
function setExpanded(topic: Topic, expanded: boolean, all = false) {
  if (!mind) return
  const id = topic.nodeObj.id
  if (all || id === mind.nodeData.id) {
    // The root has no single-branch expander. Bulk expansion rebuilds the DOM and emits no save event.
    mind.expandNodeAll(topic, expanded)
    mind.selectNode(mind.findEle(id))
    changed(); selection()
  } else mind.expandNode(topic, expanded)
}
async function action(value: MapAction) {
  context.value = undefined; floating.value = undefined
  if (!mind) return
  if (value === 'fit') { fit(); return }
  if (value === 'center') { mind.toCenter(); position(); return }
  if (value === 'reset') { mind.scale(1); position(); return }
  if (props.disabled) return
  try {
    const topic = currentTopic(); if (!topic) return
    const root = topic.nodeObj.id === mind.nodeData.id
    if (value === 'child') await mind.addChild(topic)
    else if (value === 'root-child') { const target = mind.findEle(mind.nodeData.id); mind.selectNode(target); await mind.addChild(target) }
    else if (value === 'sibling' || value === 'before') {
      if (root) await mind.addChild(topic)
      else await mind.insertSibling(value === 'before' ? 'before' : 'after', topic)
    } else if (value === 'parent' && !root) await mind.insertParent(topic)
    else if (value === 'edit') await mind.beginEdit(topic)
    else if (value === 'delete' && !rootSelected.value) await mind.removeNodes([...mind.currentNodes])
    else if (value === 'fold' && hasChildren.value) setExpanded(topic, folded.value)
    else if (value === 'expand-all' || value === 'collapse-all') setExpanded(mind.findEle(mind.nodeData.id), value === 'expand-all', true)
    await nextTick(); selection()
  } catch (cause) { emit('error', cause instanceof Error ? cause.message : '节点操作失败，请重试。') }
}
function undo() {
  if (!mind || props.disabled || !undoDepth.value) return
  mind.undo(); undoDepth.value--; redoDepth.value++; changed(); selection()
}
function redo() {
  if (!mind || props.disabled || !redoDepth.value) return
  mind.redo(); undoDepth.value++; redoDepth.value--; changed(); selection()
}
function scale(delta: number) { if (mind) mind.scale(Math.max(.2, Math.min(2.5, mind.scaleVal + delta))) }
function showContext(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('[contenteditable]')) { event.stopPropagation(); return }
  event.preventDefault(); event.stopPropagation()
  if (!mind || !host.value) return
  const target = event.target instanceof Element ? event.target.closest('me-tpc') : null
  const id = target instanceof HTMLElement ? target.dataset.nodeid : undefined
  if (id?.startsWith('me')) mind.selectNode(mind.findEle(id.slice(2)))
  else mind.clearSelection()
  editing = false; selection(); floating.value = undefined
  context.value = { x: event.clientX, y: event.clientY, node: !!id }
}
function nodeMenu() {
  const bounds = mind?.currentNode?.getBoundingClientRect()
  const canvas = host.value?.getBoundingClientRect()
  if (!bounds && !canvas) return
  floating.value = undefined
  context.value = bounds ? { x: bounds.left, y: bounds.bottom + 8, node: true } : { x: (canvas?.left ?? 0) + 24, y: (canvas?.top ?? 0) + 24, node: false }
}
function navigate(key: string) {
  if (!mind) return
  const topic = currentTopic(); if (!topic) return
  const value = topic.nodeObj
  let target: NodeObj | undefined
  if (key === 'ArrowRight') {
    if (isFolded(value)) setExpanded(topic, true)
    else target = value.children?.[0]
  } else if (key === 'ArrowLeft') {
    if (value.children?.length && !isFolded(value)) setExpanded(topic, false)
    else target = value.parent
  } else {
    const siblings = value.parent?.children ?? [], index = siblings.findIndex(item => item.id === value.id)
    target = siblings[index + (key === 'ArrowUp' ? -1 : 1)]
  }
  if (target) { const element = mind.findEle(target.id); mind.selectNode(element); mind.scrollIntoView(element) }
  selection()
}
function key(event: KeyboardEvent) {
  if (!(event.target instanceof Node) || !host.value?.contains(event.target) || !mind) return
  const editingText = event.target instanceof HTMLElement && event.target.matches('input,textarea,[contenteditable]')
  const modifier = event.ctrlKey || event.metaKey, lower = event.key.toLowerCase()
  if (modifier && lower === 's') {
    event.preventDefault(); event.stopPropagation()
    if (!event.repeat) { host.value.querySelector<HTMLElement>('#input-box')?.blur(); emit('save') }
    return
  }
  if (editingText) {
    // Keep native text undo from also reaching the library's diagram-history listener.
    if (modifier && (lower === 'z' || lower === 'y')) event.stopPropagation()
    return
  }
  if (event.isComposing) return
  if (event.key === 'Tab' && event.shiftKey) return
  if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
    event.preventDefault(); event.stopPropagation(); nodeMenu(); return
  }
  if (modifier && (lower === '+' || lower === '=' || lower === '-' || lower === '0')) {
    event.preventDefault(); event.stopPropagation(); lower === '0' ? void action('reset') : scale(lower === '-' ? -.1 : .1); return
  }
  if (props.disabled) return
  let handled = true
  if (event.key === 'Tab') void action('child')
  else if (event.key === 'Enter') void action(modifier ? 'parent' : event.shiftKey ? 'before' : 'sibling')
  else if (event.key === 'F2') void action('edit')
  else if (event.key === 'Delete' || event.key === 'Backspace') void action('delete')
  else if (modifier && lower === 'z') event.shiftKey ? redo() : undo()
  else if (modifier && lower === 'y') redo()
  else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) navigate(event.key)
  else if (event.key === 'Escape') { mind.clearSelection(); selection() }
  else handled = false
  if (handled) { event.preventDefault(); event.stopPropagation() }
}
function layout(value: unknown) {
  if (!mind || props.disabled) return
  if (value === 0) mind.initLeft(); else if (value === 1) mind.initRight(); else if (value === 2) mind.initSide(); else if (value === 3) mind.initDown()
  changed(); fit()
}
function paste(event: ClipboardEvent) {
  event.preventDefault(); event.stopImmediatePropagation()
  if (props.disabled || !mind) return
  const text = event.clipboardData?.getData('text/plain').slice(0, 1000); if (!text) return
  const target = event.target
  if (target instanceof HTMLElement && target.isContentEditable) {
    const selection = window.getSelection()
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0); range.deleteContents(); const value = document.createTextNode(text)
      range.insertNode(value); range.setStartAfter(value); range.collapse(true)
    }
  } else if (mind.currentNode) void mind.setNodeTopic(mind.currentNode, text).then(changed)
}
function pointerDown() { floating.value = undefined; context.value = undefined }
function pointerUp() { position() }
onMounted(() => {
  if (!host.value) return
  const style = getComputedStyle(document.documentElement)
  mind = new MindElixir({ el: host.value, direction: props.document.direction, contextMenu: false, toolBar: false, keypress: false,
    editable: !props.disabled, newTopicName: '新节点', pasteHandler: paste, scaleMin: .2, scaleMax: 2.5,
    theme: { ...MindElixir.THEME, name: 'Workbench', palette: [style.getPropertyValue('--color-primary').trim() || '#39765b'],
      cssVar: { ...MindElixir.THEME.cssVar, '--root-bgcolor': '#39765b', '--root-color': '#fff', '--bgcolor': '#fff', '--accent-color': '#39765b' } } })
  // The library sets position:relative inline; restore the host that fills our overlay frame.
  host.value.style.position = 'absolute'
  const failure = mind.init({ nodeData: node(props.document.nodeData), direction: props.document.direction })
  if (failure) { emit('error', failure.message); return }
  mind.bus.addListener('operation', operation => {
    if (operation.name === 'beginEdit') { editing = true; floating.value = undefined; return }
    editing = false; undoDepth.value++; redoDepth.value = 0; changed(); selection()
  })
  mind.bus.addListener('expandNode', () => { changed(); selection() })
  mind.bus.addListener('selectNodes', selection); mind.bus.addListener('selectNewNode', selection); mind.bus.addListener('unselectNodes', selection)
  mind.bus.addListener('scale', value => { zoom.value = Math.round(value * 100); floating.value = undefined; context.value = undefined })
  mind.bus.addListener('move', () => { floating.value = undefined; context.value = undefined })
  mind.selectNode(mind.findEle(props.document.nodeData.id)); selection(); fit()
  resize = new ResizeObserver(() => { context.value = undefined; fit() }); resize.observe(host.value)
  host.value.addEventListener('paste', paste, true)
})
watch(() => props.document, value => {
  if (!mind || JSON.stringify(value) === baseline) return
  baseline = JSON.stringify(value); direction.value = value.direction; editing = false; context.value = undefined
  mind.refresh({ nodeData: node(value.nodeData), direction: value.direction }); mind.clearHistory?.()
  undoDepth.value = 0; redoDepth.value = 0; selection(); fit()
})
watch(() => props.disabled, value => { if (value) { mind?.disableEdit(); floating.value = undefined; context.value = undefined } else mind?.enableEdit() })
onBeforeUnmount(() => { resize?.disconnect(); cancelAnimationFrame(resizeFrame); cancelAnimationFrame(positionFrame); host.value?.removeEventListener('paste', paste, true); mind?.destroy() })
</script>

<template>
  <div class="mindmap-editor" @keydown.capture="key">
    <div class="mindmap-tools" role="toolbar" aria-label="导图编辑工具">
      <div class="mindmap-tool-group"><AButton :disabled="disabled" title="添加子节点（Tab）" @click="action('child')"><Plus :size="16" />子节点</AButton>
        <ADropdown :trigger="['click']"><AButton :disabled="disabled||!single" aria-label="插入节点菜单">插入<ChevronDown :size="13" /></AButton><template #overlay><AMenu :selectable="false"><AMenuItem :disabled="rootSelected" @click="action('sibling')">同级节点 · Enter</AMenuItem><AMenuItem :disabled="rootSelected" @click="action('before')">前置同级 · Shift+Enter</AMenuItem><AMenuItem :disabled="rootSelected" @click="action('parent')">父节点 · Ctrl+Enter</AMenuItem></AMenu></template></ADropdown>
        <AButton :disabled="disabled||!single" title="编辑节点（F2 / 双击）" @click="action('edit')"><Pencil :size="15" />编辑节点</AButton>
      </div>
      <div class="mindmap-tool-group"><AButton type="text" :disabled="disabled||!undoDepth" aria-label="撤销" title="撤销（Ctrl+Z）" @click="undo"><Undo2 :size="17" /></AButton><AButton type="text" :disabled="disabled||!redoDepth" aria-label="重做" title="重做（Ctrl+Y / Ctrl+Shift+Z）" @click="redo"><Redo2 :size="17" /></AButton></div>
      <ASelect aria-label="导图布局" :value="direction" :disabled="disabled" :options="[{value:2,label:'两侧布局'},{value:1,label:'向右布局'},{value:0,label:'向左布局'},{value:3,label:'向下布局'}]" @change="layout" />
      <APopover title="画布快捷操作" :trigger="['hover','click']"><template #content><div class="mindmap-help"><p>Tab：子节点　Enter：同级节点</p><p>Ctrl+Enter：父节点　F2 / 双击：编辑</p><p>方向键：选择 / 展开收起　Delete：删除节点</p><p>Ctrl+Z：撤销　Ctrl+Y：重做</p><p>空格＋拖动：平移　Ctrl＋滚轮：缩放</p><p>右键节点或空白处可打开操作菜单</p></div></template><AButton type="text" aria-label="画布快捷操作" title="快捷操作"><HelpCircle :size="17" /></AButton></APopover>
    </div>
    <div ref="frame" class="mindmap-frame" @pointerdown="pointerDown" @pointerup="pointerUp">
      <div ref="host" class="mindmap-canvas" tabindex="0" aria-label="思维导图画布" @contextmenu.capture="showContext" @blur.capture="position" />
      <div v-if="floating&&!context" class="mindmap-floating" role="toolbar" aria-label="当前节点快捷操作" :style="{left:floating.left+'px',top:floating.top+'px'}" @pointerdown.stop>
        <AButton type="text" aria-label="添加子节点" title="添加子节点（Tab）" @click="action('child')"><Plus :size="17" /></AButton><AButton type="text" aria-label="编辑当前节点" title="编辑当前节点（F2）" @click="action('edit')"><Pencil :size="16" /></AButton><AButton type="text" :disabled="!hasChildren" :aria-label="rootSelected ? (folded ? '展开全部分支' : '收起全部分支') : (folded ? '展开当前分支' : '收起当前分支')" :title="rootSelected ? (folded ? '展开全部分支' : '收起全部分支') : (folded ? '展开分支' : '收起分支')" @click="action('fold')"><ChevronsUpDown v-if="folded" :size="16" /><ChevronsDownUp v-else :size="16" /></AButton><AButton type="text" aria-label="更多节点操作" title="更多节点操作" @click="nodeMenu"><MoreHorizontal :size="18" /></AButton>
      </div>
      <div class="mindmap-view-controls" role="toolbar" aria-label="画布视图控制" @pointerdown.stop><AButton type="text" aria-label="缩小画布" title="缩小" :disabled="zoom<=20" @click="scale(-.1)"><Minus :size="16" /></AButton><AButton type="text" class="mindmap-zoom" aria-label="恢复 100% 缩放" title="恢复 100%" @click="action('reset')">{{ zoom }}%</AButton><AButton type="text" aria-label="放大画布" title="放大" :disabled="zoom>=250" @click="scale(.1)"><Plus :size="16" /></AButton><AButton type="text" aria-label="适应画布" title="适应画布" @click="action('fit')"><Maximize :size="16" /></AButton><AButton type="text" aria-label="回到中心主题" title="回到中心主题" @click="action('center')"><Crosshair :size="17" /></AButton></div>
      <span class="mindmap-count">{{ count }} 个节点</span>
    </div>
    <MindmapContextMenu v-if="context&&host" :x="context.x" :y="context.y" :items="menuItems" :anchor="host" @close="context=undefined" @action="action" />
  </div>
</template>

<style scoped>
.mindmap-editor{display:flex;flex:1;flex-direction:column;min-height:0;min-width:0}.mindmap-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--color-border);background:var(--color-surface)}.mindmap-tool-group{display:flex;align-items:center;gap:4px}.mindmap-tool-group+.mindmap-tool-group{padding-left:10px;border-left:1px solid var(--color-border)}.mindmap-tools :deep(.ant-select){min-width:120px}.mindmap-tools>button:last-child{margin-left:auto}.mindmap-help p{font-size:12px;line-height:1.8;margin:4px 0}.mindmap-frame{position:relative;flex:1;min-height:300px;overflow:hidden}.mindmap-canvas{position:absolute;inset:0;overflow:hidden;background:var(--color-surface)}.mindmap-canvas:focus-visible{outline:2px solid var(--color-primary);outline-offset:-2px}.mindmap-floating,.mindmap-view-controls{display:flex;align-items:center;gap:2px;padding:4px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface);box-shadow:0 3px 14px #0001;z-index:4}.mindmap-floating{position:absolute;max-width:calc(100% - 16px)}.mindmap-floating :deep(.ant-btn),.mindmap-view-controls :deep(.ant-btn){display:flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;color:var(--color-text)}.mindmap-view-controls{position:absolute;right:16px;bottom:16px}.mindmap-view-controls .mindmap-zoom{width:52px;font-size:12px;font-variant-numeric:tabular-nums}.mindmap-count{position:absolute;left:16px;bottom:26px;font-size:12px;color:var(--color-text-muted);pointer-events:none}
@media(max-width:600px){.mindmap-tools{gap:8px;padding:10px}.mindmap-tools :deep(.ant-btn){min-height:40px;padding-inline:10px}.mindmap-tools :deep(.ant-select){min-width:108px}.mindmap-frame{min-height:360px}.mindmap-floating :deep(.ant-btn),.mindmap-view-controls :deep(.ant-btn){width:40px;height:40px}.mindmap-view-controls{right:8px;bottom:8px}.mindmap-count{left:12px;bottom:62px}}
</style>
