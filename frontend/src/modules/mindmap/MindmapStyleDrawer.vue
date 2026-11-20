<script setup lang="ts">
import { Button as AButton, Select as ASelect } from 'ant-design-vue'
import { Check, CornerDownRight, Minus, Spline, X } from 'lucide-vue-next'
import { lineStyles, nodeColors, type LineStyle, type MapDocument, type NodeColor } from './types'

defineProps<{ topic?: string; color?: NodeColor; lineStyle: LineStyle; direction: MapDocument['direction']; disabled: boolean }>()
const emit = defineEmits<{ close: []; color: [value: NodeColor | 'default']; line: [value: LineStyle]; layout: [value: unknown] }>()

const lineIcons = { curve: Spline, straight: Minus, elbow: CornerDownRight }
const layoutOptions = [{ value: 2, label: '两侧布局' }, { value: 1, label: '向右布局' },
  { value: 0, label: '向左布局' }, { value: 3, label: '向下布局' }]
</script>

<template>
  <aside id="mindmap-style-drawer" class="mindmap-style-drawer" aria-label="导图样式" @keydown.esc.stop="emit('close')">
    <header class="style-drawer-header">
      <h2>导图样式</h2>
      <AButton type="text" aria-label="关闭样式" title="关闭样式" @click="emit('close')"><X :size="18" /></AButton>
    </header>
    <div class="style-drawer-body">
      <section class="style-section" aria-labelledby="style-topic-title">
        <h3 id="style-topic-title">节点</h3>
        <template v-if="topic">
          <p class="style-topic" :title="topic">{{ topic }}</p>
          <div class="style-swatches" role="group" aria-label="节点颜色">
            <button type="button" class="style-default" :aria-pressed="!color" :disabled="disabled" @click="emit('color', 'default')">
              自动配色 <Check v-if="!color" :size="14" aria-hidden="true" />
            </button>
            <button v-for="(palette, key) in nodeColors" :key="key" type="button" :aria-pressed="color === key" :disabled="disabled" @click="emit('color', key)">
              <span class="style-swatch" :style="{ background: palette.background, color: palette.text, borderColor: palette.accent }" aria-hidden="true">
                <Check v-if="color === key" :size="13" />
              </span>
              {{ palette.label }}
            </button>
          </div>
        </template>
        <p v-else class="style-topic">选中单个节点后可以设置颜色。</p>
      </section>
      <section class="style-section" aria-labelledby="style-map-title">
        <h3 id="style-map-title">整图</h3>
        <div class="style-field">
          <span>连接线</span>
          <div class="style-lines" role="group" aria-label="连接线样式">
            <button v-for="(label, key) in lineStyles" :key="key" type="button" :disabled="disabled" :aria-pressed="lineStyle === key" @click="emit('line', key)">
              <component :is="lineIcons[key]" :size="18" aria-hidden="true" />{{ label }}
            </button>
          </div>
        </div>
        <label class="style-field">布局<ASelect aria-label="导图布局" :value="direction" :options="layoutOptions" :disabled="disabled" @change="value => emit('layout', value)" /></label>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.mindmap-style-drawer { position:absolute; inset:0 0 0 auto; z-index:6; width:min(var(--mindmap-style-width), 100%); display:flex; flex-direction:column; background:var(--color-surface); border-inline-start:1px solid var(--color-border); box-shadow:-8px 0 24px #29344512; }
.style-drawer-header { min-height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:6px 12px 6px 16px; border-bottom:1px solid var(--color-border); }
.style-drawer-header h2 { margin:0; font-size:15px; font-weight:650; }
.style-drawer-header :deep(.ant-btn) { display:grid; place-items:center; min-width:40px; min-height:40px; padding:0; }
.style-drawer-body { flex:1; overflow:auto; min-height:0; overscroll-behavior:contain; }
.style-section { display:grid; gap:10px; padding:16px; }
.style-section + .style-section { border-top:1px solid var(--color-border); }
.style-section h3 { margin:0; font-size:14px; font-weight:650; }
.style-topic { margin:0; color:var(--color-text-muted); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.style-field { display:grid; gap:6px; font-size:13px; }
.style-swatches, .style-lines { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:6px; }
.style-swatches button, .style-lines button { min-height:38px; display:flex; align-items:center; justify-content:center; gap:5px; padding:5px; font:inherit; font-size:12px; color:var(--color-text); background:var(--color-surface); border:1px solid var(--color-border); border-radius:7px; cursor:pointer; }
.style-swatches button[aria-pressed="true"], .style-lines button[aria-pressed="true"] { color:var(--color-text); background:var(--color-selection); border-color:var(--color-primary); }
.style-swatches button:focus-visible, .style-lines button:focus-visible { outline:2px solid var(--color-primary); outline-offset:1px; }
.style-swatches button:disabled, .style-lines button:disabled { cursor:default; opacity:.55; }
.style-swatches .style-default { grid-column:1 / -1; }
.style-swatch { display:grid; place-items:center; width:16px; height:16px; border:1px solid; border-radius:4px; }
.style-lines button { flex-direction:column; min-height:52px; white-space:nowrap; }
@media (width <= 600px) {
  .style-drawer-header :deep(.ant-btn), .style-swatches button { min-height:44px; }
  .style-drawer-header :deep(.ant-btn) { min-width:44px; }
}
</style>
