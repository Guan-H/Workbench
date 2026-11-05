<script setup lang="ts">
import { Button as AButton, Checkbox as ACheckbox, Input as AInput, InputNumber as AInputNumber } from 'ant-design-vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Copy, Eye, EyeOff, RefreshCw, X } from 'lucide-vue-next'
import AppMessage, { type Notice } from '../../shared/AppMessage.vue'
import { generatePassword, type PasswordCharacterKind } from './password-generator'

const choices: { value: PasswordCharacterKind; label: string; example: string }[] = [
  { value: 'uppercase', label: '大写字母', example: 'A–Z' },
  { value: 'lowercase', label: '小写字母', example: 'a–z' },
  { value: 'digits', label: '数字', example: '0–9' },
  { value: 'symbols', label: '符号', example: '!@#…' },
]
const length = ref<number>()
length.value = 20
const kinds = ref<PasswordCharacterKind[]>(choices.map(choice => choice.value))
const password = ref('')
const visible = ref(false)
const copying = ref(false)
const error = ref('')
const feedback = ref<Notice>()
const panel = ref<HTMLElement>()
const valid = computed(() => length.value !== undefined && Number.isInteger(length.value) && length.value >= 8 && length.value <= 128 && kinds.value.length > 0)
let hideTimer: ReturnType<typeof setTimeout> | undefined
let feedbackTimer: ReturnType<typeof setTimeout> | undefined
let revision = 0
let alive = true

function hide() { visible.value = false; clearTimeout(hideTimer) }
function clear() {
  revision++; hide(); password.value = ''; error.value = ''; feedback.value = undefined
  clearTimeout(feedbackTimer)
}
function toggle(kind: PasswordCharacterKind) {
  kinds.value = kinds.value.includes(kind) ? kinds.value.filter(value => value !== kind) : [...kinds.value, kind]
}
function generate() {
  clear()
  try { password.value = generatePassword({ length: length.value ?? 0, kinds: kinds.value }) }
  catch (cause) { error.value = cause instanceof RangeError ? cause.message : '浏览器安全随机源不可用，未生成密码，请更换浏览器后重试。' }
}
function reveal() {
  if (!password.value) return
  if (visible.value) hide()
  else { visible.value = true; hideTimer = setTimeout(hide, 30000) }
}
async function copy() {
  if (!password.value || copying.value) return
  const expected = revision
  copying.value = true; error.value = ''; feedback.value = undefined
  try {
    await navigator.clipboard.writeText(password.value)
    if (alive && expected === revision) {
      feedback.value = { kind: 'success', text: '密码已复制。使用后请自行清理剪贴板。' }
      feedbackTimer = setTimeout(() => { feedback.value = undefined }, 4000)
    }
  } catch {
    if (alive && expected === revision) {
      error.value = '复制失败。请点击“显示密码”后，在下方输入框中选择并手动复制。'
      await nextTick()
      panel.value?.querySelector<HTMLInputElement>('#generated-password')?.focus()
    }
  } finally { if (alive) copying.value = false }
}
function visibilityChanged() { if (document.hidden) hide() }
watch([length, kinds], clear)
onMounted(() => { document.addEventListener('visibilitychange', visibilityChanged); window.addEventListener('pagehide', clear) })
onBeforeUnmount(() => {
  alive = false; clear()
  document.removeEventListener('visibilitychange', visibilityChanged); window.removeEventListener('pagehide', clear)
})
</script>

<template>
  <section ref="panel" class="home-card password-generator" aria-labelledby="password-generator-title">
    <header class="home-card-heading"><h2 id="password-generator-title">密码生成器</h2><span>仅在当前页面生成</span></header>
    <p class="field-help">默认 20 位，每种已选字符至少包含一个。生成结果不会保存到服务器，也不会修改你的登录口令。</p>
    <div class="password-generator-options">
      <div class="password-length"><label for="password-length">密码长度</label><AInputNumber id="password-length" :value="length" :min="8" :max="128" :precision="0" :disabled="copying" @update:value="value => length = typeof value === 'number' ? value : undefined" /><span class="field-help">8–128 位</span></div>
      <fieldset><legend>字符类型</legend><div class="password-character-choices"><ACheckbox v-for="choice in choices" :key="choice.value" :checked="kinds.includes(choice.value)" :disabled="copying" @change="toggle(choice.value)">{{ choice.label }} <small>{{ choice.example }}</small></ACheckbox></div></fieldset>
    </div>
    <p v-if="!valid" class="error-message" role="alert">请输入 8–128 位整数，并至少选择一种字符类型。</p>
    <div class="password-generator-actions"><AButton type="primary" :disabled="!valid || copying" @click="generate"><RefreshCw :size="16" aria-hidden="true" />{{ password ? '重新生成密码' : '生成密码' }}</AButton><AButton v-if="password" :disabled="copying" @click="clear"><X :size="16" aria-hidden="true" />清除结果</AButton></div>
    <template v-if="password">
      <label for="generated-password" class="generated-password-label">生成的密码</label>
      <div class="generated-password-row">
        <AInput id="generated-password" :value="password" :type="visible ? 'text' : 'password'" readonly autocomplete="off" spellcheck="false" :aria-describedby="error ? 'generator-error' : 'generator-help'" />
        <AButton :aria-label="visible ? '隐藏生成的密码' : '显示生成的密码'" :title="visible ? '隐藏生成的密码' : '显示生成的密码'" :aria-pressed="visible" @click="reveal"><component :is="visible ? EyeOff : Eye" :size="17" aria-hidden="true" /></AButton>
        <AButton :disabled="copying" @click="copy"><Copy :size="16" aria-hidden="true" />{{ copying ? '正在复制…' : '复制密码' }}</AButton>
      </div>
      <p id="generator-help" class="field-help">显示后 30 秒自动隐藏，离开页面会清除结果。剪贴板和系统剪贴板历史需要你自行管理。</p>
    </template>
    <p v-if="error" id="generator-error" class="error-message" role="alert">{{ error }}</p>
    <AppMessage :notice="feedback" @close="feedback = undefined" />
  </section>
</template>
