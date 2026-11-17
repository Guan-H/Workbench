<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Input as AInput, Textarea as ATextarea } from 'ant-design-vue'
import { ref } from 'vue'
import { FilePlus2, Link2, X } from 'lucide-vue-next'
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
  <AppDialog label="添加阅读文章" :width="800">
    <form class="learning-dialog reading-add" novalidate @submit.prevent="save">
      <header class="learning-dialog-header">
        <span class="learning-dialog-icon"><FilePlus2 :size="22" aria-hidden="true" /></span>
        <div class="learning-dialog-title"><h2>添加文章</h2><p>把想读的内容，收进自己的阅读列表。</p></div>
        <AButton type="text" class="learning-dialog-close" aria-label="关闭添加文章" :disabled="saving" @click="emit('close')"><X :size="18" aria-hidden="true" /></AButton>
      </header>
      <div class="learning-dialog-body reading-add-fields">
        <AAlert v-if="error" type="error" show-icon :message="error" />
        <div class="reading-field">
          <label for="reading-title">文章标题<span class="field-required">必填</span></label>
          <AInput id="reading-title" v-model:value="title" :maxlength="200" :disabled="!!pending" required placeholder="给这篇文章起个名字" />
        </div>
        <div class="reading-text-columns">
          <div class="reading-field">
            <label for="reading-text">原文<span class="field-required">必填</span></label>
            <ATextarea id="reading-text" v-model:value="text" :maxlength="100000" :rows="10" :disabled="!!pending" required placeholder="粘贴想阅读的英文正文…" />
          </div>
          <div class="reading-field">
            <label for="reading-translation">译文<span>选填</span></label>
            <ATextarea id="reading-translation" v-model:value="translation" :maxlength="100000" :rows="10" :disabled="!!pending" placeholder="有译文时可以一起保存，方便对照阅读。" />
          </div>
        </div>
        <div class="reading-field">
          <label for="reading-source"><Link2 :size="14" aria-hidden="true" />来源链接<span>选填</span></label>
          <AInput id="reading-source" v-model:value="sourceUrl" :maxlength="2000" :disabled="!!pending" type="url" placeholder="https://…" />
        </div>
        <p class="learning-dialog-hint">仅保存粘贴的文字和出处，不自动抓取网页、翻译或生成练习。</p>
      </div>
      <footer class="learning-dialog-footer"><span class="learning-dialog-hint">保存后可在「阅读」中查看</span><AButton :disabled="saving" @click="emit('close')">取消</AButton><AButton html-type="submit" type="primary" :loading="saving" :disabled="!title.trim() || !text.trim()">{{ pending ? '重试原保存' : '保存文章' }}</AButton></footer>
    </form>
  </AppDialog>
</template>

<style scoped src="./reading-dialog.css"></style>
<style scoped>
.reading-add-fields { display: grid; gap: 20px; }
.reading-field { display: grid; align-content: start; gap: 8px; min-width: 0; }
.reading-field label { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
.reading-field label span { margin-left: auto; font-size: 12px; font-weight: 400; color: var(--color-text-muted); }
.reading-field label .field-required { color: var(--color-primary); }
.reading-field .ant-input { border-radius: 8px; padding: 10px 12px; font-size: 14px; }
.reading-field textarea { line-height: 1.8; resize: vertical; }
.reading-text-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
@media (max-width: 600px) {
  .reading-text-columns { grid-template-columns: minmax(0, 1fr); }
  .reading-field textarea { height: 180px; }
}
</style>
