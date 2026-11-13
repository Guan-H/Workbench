<script setup lang="ts">
import { Button as AButton, Slider as ASlider, Select as ASelect, Alert as AAlert, message } from 'ant-design-vue'
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { api } from '../../shared/api/client'
import { appearancePreferences, surfaceTransparency } from './appearance-preferences'
import { applyTheme, loadServerTheme, savedTheme, themeError, type ThemeSettings, type SavedTheme } from './server-appearance'

const draft = ref<ThemeSettings>()
const busy = ref(false)
const error = ref('')
const mobile = ref(false)
const gallery = ref<string[]>([])
const recommendation = ref<{ accent: string; overlay: number }>()
async function recommend(id: string) {
  recommendation.value = undefined
  const img = new Image()
  img.src = '/api/v1/settings/appearance/images/' + id
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 24
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.drawImage(img, 0, 0, 24, 24)
  const pixels = ctx.getImageData(0, 0, 24, 24).data
  let red = 0, green = 0, blue = 0
  for (let i = 0; i < pixels.length; i += 4) {
    red += pixels[i]!; green += pixels[i+1]!; blue += pixels[i+2]!
  }
  const luminance = (.213 * red + .715 * green + .072 * blue) / (24 * 24 * 255)
  recommendation.value = {
    accent: red > green * 1.08 ? (blue > green ? '#7a6197' : '#8b5f47') : green > blue * 1.06 ? '#527b71' : '#526b83',
    overlay: Math.round(75 - 40 * luminance),
  }
}
const colors = [
  { value: '#526b83', label: '灰蓝' }, { value: '#8b5f47', label: '暖棕' },
  { value: '#7a6197', label: '柔紫' }, { value: '#527b71', label: '青绿' },
]
async function reload() {
  busy.value = true
  await loadServerTheme()
  if (savedTheme.value) draft.value = { ...savedTheme.value.settings }
  try { gallery.value = await api<string[]>('/settings/appearance/images') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '图库读取失败' }
  busy.value = false
}
async function upload(event: Event, target: 'desktop' | 'mobile') {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !draft.value) return
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 8 * 1024 * 1024) {
    error.value = '请选择不超过 8 MiB 的 PNG 或 JPEG 图片。'; return
  }
  busy.value = true; error.value = ''
  try {
    const form = new FormData(); form.append('file', file)
    const result = await api<{ id: string }>('/settings/appearance/images', { method: 'POST', body: form })
    draft.value[target] = result.id
    gallery.value.unshift(result.id)
    mobile.value = target === 'mobile'
    await recommend(result.id)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '上传失败' }
  finally { busy.value = false }
}
function collect() {
  if (!draft.value) return
  return { ...draft.value, ...appearancePreferences.value,
    notesTransparency: surfaceTransparency.value.notes, mindmapTransparency: surfaceTransparency.value.mindmap }
}
function preview() { const value = collect(); if (value) applyTheme(value) }
function cancel() {
  if (savedTheme.value) { draft.value = { ...savedTheme.value.settings }; applyTheme(savedTheme.value.settings) }
}
async function save() {
  const settings = collect()
  if (!settings || !savedTheme.value) return
  busy.value = true; error.value = ''
  try {
    const result = await api<SavedTheme>('/settings/appearance', {
      method: 'PUT', body: JSON.stringify({ version: savedTheme.value.version, settings }),
    })
    savedTheme.value = result; draft.value = { ...result.settings }; applyTheme(result.settings)
    message.success('外观已保存，其他设备刷新后生效')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存结果未确认，请重新读取核对' }
  finally { busy.value = false }
}
onMounted(reload)
onBeforeUnmount(cancel)
</script>

<template>
  <section class="background-settings">
    <h3>共享背景与配色</h3>
    <p>上传后先预览，点击应用才同步到其他设备。PNG / JPEG，最多 8 MiB、2400 万像素。</p>
    <AAlert v-if="error || themeError" type="error" show-icon :message="error || themeError" />
    <template v-if="draft">
      <div class="background-actions">
        <label>桌面背景<input type="file" accept="image/png,image/jpeg" :disabled="busy" @change="upload($event, 'desktop')" /></label>
        <label>手机背景<input type="file" accept="image/png,image/jpeg" :disabled="busy" @change="upload($event, 'mobile')" /></label>
        <AButton :disabled="busy" @click="draft.desktop = null; draft.mobile = null">恢复内置图片</AButton>
      </div>
      <AButton @click="mobile = !mobile">{{ mobile ? '切换桌面预览' : '切换手机预览' }}</AButton>
      <label v-if="gallery.length">为当前预览选择已上传图片
        <ASelect :value="draft[mobile ? 'mobile' : 'desktop'] || ''" :options="[{value:'', label: mobile ? '跟随桌面' : '内置背景'}, ...gallery.map((id,index) => ({value:id,label:'图片 ' + (gallery.length-index) + ' · ' + id.slice(0,6)}))]" @change="id => { if(draft){ draft[mobile ? 'mobile' : 'desktop'] = id ? String(id) : null; recommendation = undefined; if(id) void recommend(String(id)).catch(() => {error='无法分析图片颜色'}) } }" />
      </label>
      <AButton v-if="recommendation" @click="draft.accent = recommendation.accent; draft.overlay = recommendation.overlay">使用推荐配色与遮罩（{{ colors.find(c => c.value === recommendation?.accent)?.label }} · {{ recommendation.overlay }}%）</AButton>
      <div class="background-preview" :class="{ mobile }" :style="{
        backgroundImage: (mobile ? draft.mobile || draft.desktop : draft.desktop) ? 'url(/api/v1/settings/appearance/images/' + (mobile ? draft.mobile || draft.desktop : draft.desktop) + ')' : undefined,
        backgroundPosition: mobile ? draft.mobileX + '% ' + draft.mobileY + '%' : draft.desktopX + '% ' + draft.desktopY + '%'
      }">
        <div :style="{ background: 'rgb(247 246 243 / ' + draft.overlay / 100 + ')' }">
          <article><strong>工作区预览</strong><p>正文与操作区域保留清晰底色</p><span :style="{ background: draft.accent }">选中 / 主要操作</span></article>
        </div>
      </div>
      <label>水平位置<ASlider v-if="mobile" v-model:value="draft.mobileX" /><ASlider v-else v-model:value="draft.desktopX" /></label>
      <label>垂直位置<ASlider v-if="mobile" v-model:value="draft.mobileY" /><ASlider v-else v-model:value="draft.desktopY" /></label>
      <label>浅色遮罩 · {{ draft.overlay }}%<ASlider v-model:value="draft.overlay" :min="20" :max="90" /></label>
      <label>配套强调色<ASelect v-model:value="draft.accent" :options="colors" style="width: 140px; margin-left: 12px" /></label>
      <div class="background-actions">
        <AButton :disabled="busy" @click="preview">预览到工作区</AButton>
        <AButton type="primary" :loading="busy" @click="save">应用并同步</AButton>
        <AButton :disabled="busy" @click="cancel">取消预览</AButton>
        <AButton :disabled="busy" @click="reload">重新读取</AButton>
      </div>
    </template>
    <AButton v-else :loading="busy" @click="reload">读取外观设置</AButton>
  </section>
</template>

<style scoped>
.background-settings{display:grid;gap:16px;border-top:1px solid var(--color-border);padding-top:20px}
.background-settings p{font-size:13px;color:var(--color-text-muted)}
.background-actions{display:flex;flex-wrap:wrap;gap:16px}
.background-actions label{display:grid;gap:8px;max-width:100%}
input{max-width:100%}
.background-preview{height:240px;background: url('../../assets/themes/one-punch/background-desktop.webp') center/cover;border-radius:12px;overflow:hidden}
.background-preview.mobile{width:200px;height:320px;max-width:100%}
.background-preview>div{height:100%;padding:24px;box-sizing:border-box}
article{background:#ffffffe8;padding:20px;border-radius:8px}article span{color:white;padding:6px 12px;border-radius:6px;font-size:12px}
</style>
