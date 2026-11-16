<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Input as AInput, Textarea as ATextarea } from 'ant-design-vue'
import { ref } from 'vue'
import { X } from 'lucide-vue-next'
import AppDialog from '../../shared/AppDialog.vue'
import { ApiError, write } from '../../shared/api/client'
import type { CourseDetail } from './course-types'

const props = defineProps<{ username: string }>()
const emit = defineEmits<{ close: []; saved: [detail: CourseDetail] }>()
const title = ref(''), text = ref(''), translation = ref(''), sourceUrl = ref('')
const error = ref(''), saving = ref(false), rejected = ref(false)
const key = 'workbench-reading-add:' + encodeURIComponent(props.username)
type Draft = { title: string; text: string; translation: string; sourceUrl: string }
const pending = ref<{ operation: string; request: Draft }>()
try {
  const raw = sessionStorage.getItem(key)
  if (raw) {
    pending.value = JSON.parse(raw)
    const value = pending.value!.request
    title.value = value.title; text.value = value.text; translation.value = value.translation; sourceUrl.value = value.sourceUrl
    error.value = '有一篇文章的保存结果尚未确认，请重试原操作。'
  }
} catch { pending.value = undefined; error.value = '本机待确认文章无法读取，请保留浏览器数据后重试。' }
async function save() {
  if (saving.value) return
  if (!pending.value) {
    const value = { operation: crypto.randomUUID(), request: { title: title.value, text: text.value, translation: translation.value, sourceUrl: sourceUrl.value } }
    try { sessionStorage.setItem(key, JSON.stringify(value)) }
    catch { error.value = '无法暂存待确认文章，请检查浏览器存储后重试。'; return }
    pending.value = value
  }
  saving.value = true; error.value = ''; rejected.value = false
  try {
    const value = await write<CourseDetail>('/home/english/courses', 'POST', pending.value.request, pending.value.operation)
    sessionStorage.removeItem(key); pending.value = undefined
    emit('saved', value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存结果未确认，请重试。'
    rejected.value = cause instanceof ApiError && cause.status === 400
    if (rejected.value) { sessionStorage.removeItem(key); pending.value = undefined }
  } finally { saving.value = false }
}
</script>

<template>
  <AppDialog label="添加阅读文章" :width="720">
    <form class="reading-add" novalidate @submit.prevent="save">
      <header><h2>添加文章</h2><AButton type="text" aria-label="关闭添加文章" :disabled="saving" @click="emit('close')"><X :size="18" /></AButton></header>
      <AAlert v-if="error" type="error" show-icon :message="error" />
      <div class="reading-add-fields">
        <label for="reading-title">标题<AInput id="reading-title" v-model:value="title" :maxlength="200" :disabled="!!pending" required /></label>
        <label for="reading-text">原文<ATextarea id="reading-text" v-model:value="text" :maxlength="100000" :rows="8" :disabled="!!pending" required placeholder="粘贴想阅读的正文" /></label>
        <label for="reading-translation">译文（可选）<ATextarea id="reading-translation" v-model:value="translation" :maxlength="100000" :rows="4" :disabled="!!pending" placeholder="没有译文也能保存，不会自动翻译" /></label>
        <label for="reading-source">来源链接（可选）<AInput id="reading-source" v-model:value="sourceUrl" :maxlength="2000" :disabled="!!pending" type="url" placeholder="https://…" /></label>
        <p>来源链接仅作记录，不会自动读取网页；原文和译文按纯文本保存。暂不自动生成句子解析或练习。</p>
      </div>
      <footer><AButton :disabled="saving" @click="emit('close')">关闭</AButton><AButton html-type="submit" type="primary" :loading="saving" :disabled="!title.trim() || !text.trim()">{{ pending ? '重试原保存' : '保存文章' }}</AButton></footer>
    </form>
  </AppDialog>
</template>

<style scoped>
.reading-add{display:flex;flex-direction:column;gap:16px;padding:8px;max-height:80dvh}.reading-add header,.reading-add footer{display:flex;align-items:center;justify-content:space-between;gap:12px}.reading-add h2{margin:0;font-size:20px}.reading-add-fields{display:grid;gap:16px;overflow:auto;padding:2px}.reading-add label{display:grid;gap:8px}.reading-add p{font-size:12px;color:var(--color-text-muted);line-height:1.8;margin:0}.reading-add footer{justify-content:flex-end;border-top:1px solid var(--color-border);padding-top:16px}@media(max-width:600px){.reading-add .ant-btn{min-height:44px}}
</style>
