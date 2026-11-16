<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Textarea as ATextarea, Tag as ATag } from 'ant-design-vue'
import { ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import AppDialog from '../../shared/AppDialog.vue'
import { ApiError, write } from '../../shared/api/client'
import { wordGameOperationId } from './word-game'
import type { WordImportPreview, WordImportResult } from './study-types'

const props = defineProps<{ username: string }>()
const emit = defineEmits<{ close: []; saved: [result: WordImportResult] }>()
const text = ref(''), error = ref(''), busy = ref(false), preview = ref<WordImportPreview>()
const key = 'workbench-word-import:' + encodeURIComponent(props.username)
const pending = ref<{ operation: string; text: string }>()
const storageFailed = ref(false)
try {
  const raw = sessionStorage.getItem(key)
  if (raw) {
    const value = JSON.parse(raw)
    if (typeof value?.operation !== 'string' || typeof value?.text !== 'string') throw new Error('Invalid draft')
    pending.value = value
    text.value = value.text
    error.value = '上次导入结果尚未确认，请重试原操作，不会重复录入。'
  }
} catch { storageFailed.value = true; error.value = '无法读取本机待确认导入，请保留浏览器数据后重新打开。' }

watch(text, () => { preview.value = undefined })
async function inspect() {
  if (busy.value || pending.value || storageFailed.value) return
  busy.value = true; error.value = ''
  try { preview.value = await write<WordImportPreview>('/home/english/study/words/import-preview', 'POST', { text: text.value }) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '预览失败，请重试。' }
  finally { busy.value = false }
}
async function save() {
  if (busy.value || storageFailed.value || (!pending.value && (!preview.value || preview.value.invalid))) return
  if (!pending.value) {
    const value = { operation: wordGameOperationId(), text: text.value }
    try { sessionStorage.setItem(key, JSON.stringify(value)) }
    catch { error.value = '无法暂存待确认导入，请检查浏览器存储后重试。'; return }
    pending.value = value
  }
  busy.value = true; error.value = ''
  try {
    const result = await write<WordImportResult>('/home/english/study/words/import', 'POST', { text: pending.value.text }, pending.value.operation)
    sessionStorage.removeItem(key); pending.value = undefined
    emit('saved', result)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '导入结果尚未确认，请重试原操作。'
    if (cause instanceof ApiError && cause.status === 400) {
      sessionStorage.removeItem(key); pending.value = undefined; preview.value = undefined
    }
  } finally { busy.value = false }
}
</script>

<template>
  <AppDialog label="导入单词" :width="660">
    <section class="word-import" aria-labelledby="word-import-title" :aria-busy="busy">
      <header><div><h2 id="word-import-title">导入单词</h2><p>一行一个，填写“单词：释义”即可。</p></div><AButton type="text" aria-label="关闭导入单词" :disabled="busy" @click="emit('close')"><X :size="18" /></AButton></header>
      <div class="word-import-body">
        <AAlert v-if="error" type="error" show-icon :message="error" />
        <label for="word-import-text">单词与释义</label>
        <ATextarea id="word-import-text" v-model:value="text" :rows="7" :maxlength="100000" :disabled="busy || !!pending || storageFailed" placeholder="convenient：方便的；便利的&#10;improve：提高；改善&#10;look forward to：期待" />
        <p class="word-import-help">支持中英文冒号，每批最多 500 行。重复词义自动跳过，不覆盖已有例句和学习记录。导入后可立即挑战；已生成的今日计划不重排。</p>
        <template v-if="preview">
          <div class="word-import-summary" role="status"><ATag color="blue">新增 {{ preview.newWords }}</ATag><ATag>重复 {{ preview.duplicates }}</ATag><ATag :color="preview.invalid ? 'error' : undefined">错误 {{ preview.invalid }}</ATag></div>
          <p v-if="preview.invalid" class="word-import-help">请修改错误行后重新预览，本次尚未导入任何单词。</p>
          <ol class="word-import-preview" aria-label="单词导入预览"><li v-for="entry in preview.entries" :key="entry.line" :class="{ invalid: entry.status === 'invalid' }"><span>第 {{ entry.line }} 行</span><div><strong lang="en">{{ entry.word }}</strong><p>{{ entry.meaning }}</p><small>{{ entry.message }}</small></div></li></ol>
        </template>
      </div>
      <footer><AButton :disabled="busy" @click="emit('close')">关闭</AButton><AButton v-if="!pending" :loading="busy" :disabled="!text.trim() || storageFailed" @click="inspect">预览</AButton><AButton type="primary" :loading="busy" :disabled="storageFailed || (!pending && (!preview || preview.invalid > 0))" @click="save">{{ pending ? '重试原导入' : '确认导入' }}</AButton></footer>
    </section>
  </AppDialog>
</template>

<style scoped>
.word-import{display:flex;flex-direction:column;max-height:calc(100dvh - 64px);min-height:0}
.word-import header{display:flex;justify-content:space-between;gap:12px;padding:20px 24px;border-bottom:1px solid var(--color-border)}
.word-import h2{margin:0 0 6px;font-size:21px}.word-import header p{margin:0;color:var(--color-text-muted);font-size:13px}
.word-import-body{min-height:0;overflow:auto;padding:18px 24px;scrollbar-gutter:stable}.word-import-body>label{display:block;margin:12px 0 8px}.word-import-help{font-size:12px;color:var(--color-text-muted);line-height:1.8}
.word-import-summary{display:flex;gap:6px;flex-wrap:wrap;margin-top:16px}.word-import-preview{padding:0;list-style:none;margin-bottom:0}.word-import-preview li{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--color-border)}.word-import-preview li>span{flex-shrink:0;color:var(--color-text-muted);font-size:12px}.word-import-preview li>div{min-width:0;overflow-wrap:anywhere}.word-import-preview p{margin:4px 0;white-space:pre-wrap}.word-import-preview small{color:var(--color-text-muted)}.word-import-preview .invalid small{color:var(--color-danger)}
.word-import footer{display:flex;justify-content:flex-end;gap:10px;padding:16px 24px;border-top:1px solid var(--color-border)}.word-import button{min-height:40px}
@media(max-width:600px){.word-import{max-height:calc(100dvh - 32px)}.word-import header,.word-import-body{padding:16px}.word-import footer{padding:14px 16px}.word-import button{min-height:44px}}
</style>
