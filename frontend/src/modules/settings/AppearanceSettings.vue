<script setup lang="ts">
import { Alert as AAlert, RadioButton as ARadioButton, RadioGroup as ARadioGroup, Slider as ASlider } from 'ant-design-vue'
import { BrainCircuit, FileText, Palette } from 'lucide-vue-next'
import { ref } from 'vue'
import { appearancePreferences, setAppearancePreference, type AppearanceArea } from './appearance-preferences'
import { surfaceTransparency, setSurfaceTransparency } from './appearance-preferences'
import BackgroundSettings from './BackgroundSettings.vue'

const storageFailed = ref(false)
function update(area: AppearanceArea, value: unknown) {
  storageFailed.value = !setAppearancePreference(area, value)
}
</script>

<template>
  <section class="home-card appearance-settings" aria-labelledby="appearance-title">
    <header class="home-card-heading"><h2 id="appearance-title"><Palette :size="17" aria-hidden="true" />外观</h2><span>多端共享</span></header>
    <p class="field-help">调整后点击下方“应用并同步”保存到服务器。</p>
    <div class="appearance-options">
      <section class="appearance-option">
        <div><span class="appearance-icon"><FileText :size="18" aria-hidden="true" /></span><span><strong>笔记工作区</strong><small>目录和外框透景，编辑与预览保持高可读底色。</small></span></div>
        <ARadioGroup :value="appearancePreferences.notes" button-style="solid" role="radiogroup" aria-label="笔记背景效果" @update:value="update('notes', $event)">
          <ARadioButton value="paper">纸张</ARadioButton><ARadioButton value="soft">柔和透景</ARadioButton>
        </ARadioGroup>
      </section>
      <section class="appearance-option">
        <div><span class="appearance-icon mindmap"><BrainCircuit :size="18" aria-hidden="true" /></span><span><strong>思维导图</strong><small>画布显示更多背景，节点、工具栏和菜单保持实体表面。</small></span></div>
        <ARadioGroup :value="appearancePreferences.mindmap" button-style="solid" role="radiogroup" aria-label="思维导图背景效果" @update:value="update('mindmap', $event)">
          <ARadioButton value="paper">纸张</ARadioButton><ARadioButton value="soft">柔和透景</ARadioButton>
        </ARadioGroup>
      </section>
    </div>
    <div v-for="area in (['notes', 'mindmap'] as const)" :key="area">
      <template v-if="appearancePreferences[area] === 'soft'">
        <label :id="'transparency-' + area">{{ area === 'notes' ? '笔记' : '导图' }}背景透明度 · {{ surfaceTransparency[area] }}%</label>
        <ASlider :value="surfaceTransparency[area]" :min="0" :max="80" :aria-labelledby="'transparency-' + area" @update:value="storageFailed = !setSurfaceTransparency(area, $event)" />
      </template>
    </div>
    <p class="field-help">数值越大，背景图片越明显。文字和按钮不会变透明；手机端保留更厚的底色。</p>
    <AAlert v-if="storageFailed" type="warning" show-icon message="当前页面已生效，但浏览器未能保存外观设置；刷新后可能恢复默认。" />
    <BackgroundSettings />
  </section>
</template>

<style scoped>
.appearance-settings{display:grid;gap:14px}.appearance-settings .home-card-heading{margin-bottom:0}.appearance-settings h2{gap:8px}.appearance-options{display:grid;gap:10px}.appearance-option{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-paper-tint)}.appearance-option>div{display:flex;align-items:flex-start;gap:10px;min-width:0}.appearance-option strong,.appearance-option small{display:block}.appearance-option strong{font-size:14px}.appearance-option small{margin-top:5px;color:var(--color-text-muted);font-size:12px;line-height:1.6}.appearance-icon{display:grid;place-items:center;flex:0 0 34px;height:34px;border-radius:8px;background:#f3e9df;color:#9b6542}.appearance-icon.mindmap{background:#eee8f5;color:#7a6197}.appearance-option :deep(.ant-radio-group){flex-shrink:0;white-space:nowrap}@media(max-width:720px){.appearance-option{align-items:stretch;flex-direction:column}.appearance-option :deep(.ant-radio-group){display:flex}.appearance-option :deep(.ant-radio-button-wrapper){display:grid;place-items:center;flex:1;min-height:44px}}
</style>
