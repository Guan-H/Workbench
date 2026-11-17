<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Skeleton as ASkeleton, Switch as ASwitch, Tag as ATag } from 'ant-design-vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ExternalLink, Globe2, Telescope, X, RefreshCw } from 'lucide-vue-next'
import AppDialog from '../../shared/AppDialog.vue'
import { api, write } from '../../shared/api/client'
interface Source {
  id: string; name: string; revision: string; enabled: boolean; running: boolean
  lastAttemptAt: string | null; lastSuccessAt: string | null; added: number; skipped: number; error: string | null; retryAfterAt: string | null
}
const emit = defineEmits<{ close: []; changed: [] }>()
const status = ref<Source>(), loading = ref(false), error = ref('')
let disposed = false, timer: ReturnType<typeof setTimeout> | undefined
const date = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '尚无记录'
function poll() {
  clearTimeout(timer)
  if (!disposed && (status.value?.running || status.value?.enabled)) timer = setTimeout(() => void load(), status.value?.running ? 1500 : 15000)
}
async function load() {
  loading.value = true
  try {
    const value = await api<Source>('/home/english/courses/sources')
    if (!disposed) { const finished = status.value?.running && !value.running; status.value = value; error.value = ''; if (finished) emit('changed') }
  } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : '来源状态读取失败。' }
  finally { if (!disposed) { loading.value = false; poll() } }
}
async function configure(enabled: boolean) {
  if (!status.value) return
  loading.value = true; error.value = ''
  try { status.value = await write<Source>('/home/english/courses/sources/nasa', 'PUT', { baseRevision: status.value.revision, enabled }) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '设置结果尚未确认，请刷新状态核对。' }
  finally { loading.value = false; poll() }
}
async function sync() {
  loading.value = true; error.value = ''
  try { status.value = await write<Source>('/home/english/courses/sources/nasa/sync', 'POST'); if (!status.value.running) emit('changed') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '同步启动结果未确认，请刷新状态核对。' }
  finally { loading.value = false; poll() }
}
onMounted(load)
onBeforeUnmount(() => { disposed = true; clearTimeout(timer) })
</script>
<template>
  <AppDialog label="阅读内容来源" :width="680">
    <section class="learning-dialog reading-sources">
      <header class="learning-dialog-header">
        <span class="learning-dialog-icon"><Globe2 :size="22" aria-hidden="true" /></span>
        <div class="learning-dialog-title"><h2>内容来源</h2><p>管理阅读列表的外部文章来源。</p></div>
        <AButton type="text" class="learning-dialog-close" aria-label="关闭内容来源" @click="emit('close')"><X :size="18" aria-hidden="true" /></AButton>
      </header>
      <div class="learning-dialog-body source-body" :aria-busy="loading">
        <AAlert v-if="error" type="error" show-icon :message="error" />
        <ASkeleton v-if="!status && loading" active :paragraph="{ rows: 5 }" />
        <template v-if="status">
          <article class="source-card">
            <div class="source-heading">
              <span class="source-icon"><Telescope :size="23" aria-hidden="true" /></span>
              <div><h3>{{ status.name }}</h3><p>科学 · 太空 · 探索</p></div>
              <ATag :color="status.running ? 'processing' : undefined">{{ status.running ? '正在同步' : status.enabled ? '自动同步已开启' : '手动同步' }}</ATag>
            </div>
            <p class="source-description">NASA 原版科普，未做英语等级划分，可能偏难。仅收录原文和出处，不含译文、解析与题目。</p>
            <div class="source-links">
              <a href="https://www.nasa.gov/" target="_blank" rel="noopener noreferrer">来源网站<ExternalLink :size="13" aria-hidden="true" /></a>
              <a href="https://www.nasa.gov/nasa-brand-center/images-and-media/" target="_blank" rel="noopener noreferrer">使用说明<ExternalLink :size="13" aria-hidden="true" /></a>
            </div>
          </article>
          <div class="source-toggle">
            <div><label for="reading-source-auto">自动同步</label><p>每 6 小时检查近期文章，每批最多 5 篇</p></div>
            <ASwitch id="reading-source-auto" :checked="status.enabled" :disabled="loading" @change="value => configure(!!value)" />
          </div>
          <section class="source-activity" aria-label="同步记录">
            <h3>同步记录</h3>
            <dl><div><dt>最近尝试</dt><dd>{{ date(status.lastAttemptAt) }}</dd></div><div><dt>最近成功</dt><dd>{{ date(status.lastSuccessAt) }}</dd></div><div class="source-result"><dt>上次结果</dt><dd>新增 <strong>{{ status.added }}</strong> 篇<span>·</span>跳过 / 重复 {{ status.skipped }} 篇</dd></div></dl>
          </section>
          <AAlert v-if="status.error" type="warning" show-icon :message="status.error" />
          <p v-if="status.retryAfterAt" class="learning-dialog-hint">可重试时间：{{ date(status.retryAfterAt) }}</p>
          <p class="learning-dialog-hint">自动同步默认关闭。暂停不删除文章，正在执行的同步会完成；重复文章保留首次正文，不覆盖阅读进度。</p>
        </template>
      </div>
      <footer class="learning-dialog-footer"><AButton :loading="loading" @click="load"><RefreshCw :size="15" aria-hidden="true" />刷新状态</AButton><AButton type="primary" :disabled="!status || loading || status.running || !!status.retryAfterAt && Date.parse(status.retryAfterAt) > Date.now()" @click="sync">立即同步</AButton></footer>
    </section>
  </AppDialog>
</template>
<style scoped src="./reading-dialog.css"></style>
<style scoped>
.source-body { display: grid; gap: 20px; }
.source-card { border: 1px solid var(--color-border); border-radius: 12px; padding: 20px; background: var(--color-background); }
.source-heading { display: flex; align-items: center; gap: 12px; }
.source-icon { display: grid; place-items: center; width: 46px; height: 46px; flex-shrink: 0; border-radius: 10px; background: var(--color-surface); color: var(--color-primary); border: 1px solid var(--color-border); }
.source-heading > div { flex: 1; min-width: 0; }
.source-heading h3 { margin: 0 0 4px; font-size: 16px; }
.source-heading p { margin: 0; font-size: 12px; color: var(--color-text-muted); }
.source-heading .ant-tag { margin: 0; font-size: 12px; border-radius: 6px; }
.source-description { margin: 16px 0 12px; font-size: 13px; line-height: 1.8; color: var(--color-text-muted); }
.source-links { display: flex; flex-wrap: wrap; gap: 20px; }
.source-links a { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; min-height: 32px; color: var(--color-primary); }
.source-links a:hover { color: var(--color-primary-hover); text-decoration: underline; }
.source-toggle { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.source-toggle label { font-size: 14px; font-weight: 600; }
.source-toggle p { margin: 5px 0 0; font-size: 12px; color: var(--color-text-muted); line-height: 1.7; }
.source-activity { border-top: 1px solid var(--color-border); padding-top: 18px; }
.source-activity h3 { font-size: 13px; margin: 0 0 14px; }
.source-activity dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin: 0; }
.source-activity dt { font-size: 12px; color: var(--color-text-muted); margin-bottom: 6px; }
.source-activity dd { font-size: 13px; margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.source-result { grid-column: 1 / -1; }
.source-result dd span { margin: 0 10px; color: var(--color-text-muted); }
@media (max-width: 600px) {
  .source-card { padding: 16px; }
  .source-heading { display: grid; grid-template-columns: 46px minmax(0, 1fr); gap: 10px 12px; }
  .source-heading .ant-tag { grid-column: 2; justify-self: start; }
  .source-links a { min-height: 44px; }
  .source-activity dl { grid-template-columns: minmax(0, 1fr); gap: 14px; }
}
</style>
