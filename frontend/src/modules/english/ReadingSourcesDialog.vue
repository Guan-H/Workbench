<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Switch as ASwitch, Tag as ATag } from 'ant-design-vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { X, RefreshCw } from 'lucide-vue-next'
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
    <section class="reading-sources">
      <header><h2>内容来源</h2><AButton type="text" aria-label="关闭内容来源" @click="emit('close')"><X :size="18" /></AButton></header>
      <AAlert v-if="error" type="error" show-icon :message="error" />
      <AAlert type="info" show-icon message="NASA 原版科普未做英语等级划分，可能偏难；只同步原文和出处，没有译文、句子解析或题目。" />
      <template v-if="status">
        <div class="source-heading"><strong>{{ status.name }}</strong><ATag>{{ status.running ? '正在同步' : status.enabled ? '自动同步已开启' : '自动同步已关闭' }}</ATag></div>
        <label class="source-toggle">自动同步（每 6 小时检查近期内容）<ASwitch :checked="status.enabled" :disabled="loading" @change="value => configure(!!value)" /></label>
        <p>默认关闭；开启后会在后台检查近期文章。暂停不删除已保存内容，正在执行的同步会完成。每批最多 5 篇，重复文章保留首次正文，不覆盖阅读进度。</p>
        <dl><dt>最近尝试</dt><dd>{{ date(status.lastAttemptAt) }}</dd><dt>最近成功</dt><dd>{{ date(status.lastSuccessAt) }}</dd><dt>上次结果</dt><dd>新增 {{ status.added }} 篇 · 跳过/重复 {{ status.skipped }} 篇</dd></dl>
        <AAlert v-if="status.error" type="warning" show-icon :message="status.error" />
        <p v-if="status.retryAfterAt">可重试时间：{{ date(status.retryAfterAt) }}</p>
        <p><a href="https://www.nasa.gov/" target="_blank" rel="noopener noreferrer">来源网站</a> · <a href="https://www.nasa.gov/nasa-brand-center/images-and-media/" target="_blank" rel="noopener noreferrer">使用说明</a></p>
      </template>
      <footer><AButton :loading="loading" @click="load"><RefreshCw :size="15" />刷新状态</AButton><AButton type="primary" :disabled="!status || loading || status.running || !!status.retryAfterAt && Date.parse(status.retryAfterAt) > Date.now()" @click="sync">立即同步</AButton></footer>
    </section>
  </AppDialog>
</template>
<style scoped>
.reading-sources{display:grid;gap:16px;padding:8px;max-height:80dvh;overflow:auto}.reading-sources header,.reading-sources footer,.source-heading,.source-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px}.reading-sources h2{margin:0;font-size:20px}.reading-sources p{margin:0;line-height:1.8;color:var(--color-text-muted);font-size:13px}.reading-sources dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;margin:0}.reading-sources dd{margin:0;overflow-wrap:anywhere}.reading-sources footer{justify-content:flex-end;padding-top:16px;border-top:1px solid var(--color-border)}@media(max-width:600px){.reading-sources .ant-btn{min-height:44px}.source-toggle{flex-wrap:wrap}}
</style>
