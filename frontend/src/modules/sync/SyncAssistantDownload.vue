<script setup lang="ts">
import { Button as AButton } from 'ant-design-vue'
import { Download, RefreshCw } from 'lucide-vue-next'
import { onBeforeUnmount, onMounted, ref } from 'vue'

interface Release { version: string; builtAt: string; platform: string; file: string; bytes: number; sha256: string }
const release = ref<Release>(), loading = ref(false), error = ref('')
let request: AbortController | undefined
let alive = true
const date = (value: string) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
async function load() {
  request?.abort()
  const controller = request = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  loading.value = true; error.value = ''; release.value = undefined
  try {
    const response = await fetch('/downloads/sync-assistant.json', { cache: 'no-store', signal: controller.signal })
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('当前站点尚未提供助手安装包。')
    const value = await response.json() as Release
    if (!/^privatespace-sync-windows-x64-[a-f0-9]{12}\.zip$/.test(value.file) || value.platform !== 'windows-x64'
        || !/^[a-f0-9]{64}$/.test(value.sha256) || !value.file.endsWith(value.sha256.slice(0, 12) + '.zip')
        || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || typeof value.version !== 'string'
        || value.version.length > 80 || !Number.isFinite(Date.parse(value.builtAt))) throw new Error('安装包信息无效，请联系站点管理员。')
    const file = await fetch('/downloads/' + value.file, { method: 'HEAD', cache: 'no-store', signal: controller.signal })
    if (!file.ok || !/application\/(zip|octet-stream|x-zip-compressed)/i.test(file.headers.get('content-type') || '')
        || Number(file.headers.get('content-length')) !== value.bytes) throw new Error('安装包缺失或未部署完整，请稍后重试。')
    if (alive && request === controller) release.value = value
  } catch (cause) {
    if (alive && request === controller) error.value = controller.signal.aborted ? '读取安装包信息超时，请重试。' : cause instanceof Error ? cause.message : '无法读取安装包信息，请重试。'
  } finally {
    clearTimeout(timeout)
    if (alive && request === controller) loading.value = false
  }
}
onMounted(() => { void load() })
onBeforeUnmount(() => { alive = false; request?.abort() })
</script>

<template>
  <section class="home-card assistant-download" aria-labelledby="assistant-download-title" :aria-busy="loading">
    <div class="assistant-download-heading">
      <div><h2 id="assistant-download-title">Windows 同步助手</h2><p>下载并解压完整 ZIP，双击“安装同步助手.exe”，安装后可从桌面快捷方式启动。</p></div>
      <AButton v-if="release" type="primary" :href="'/downloads/' + release.file" :download="release.file"><Download :size="16" aria-hidden="true" />下载 Windows 助手</AButton>
      <AButton v-else disabled :loading="loading">{{ loading ? '正在读取安装包…' : '暂无可用安装包' }}</AButton>
    </div>
    <p v-if="loading" role="status">正在检查下载文件。</p>
    <p v-else-if="error" role="status" class="assistant-download-error">{{ error }} <AButton size="small" @click="load"><RefreshCw :size="14" aria-hidden="true" />重试</AButton></p>
    <template v-else-if="release"><p class="assistant-release-meta">Windows 64 位 · v{{ release.version }} · {{ (release.bytes / 1024 / 1024).toFixed(1) }} MiB · 构建于 {{ date(release.builtAt) }}</p><details><summary>查看文件校验值 SHA-256</summary><code>{{ release.sha256 }}</code></details></template>
    <p class="assistant-update-help">更新前请正常退出旧助手，再运行解压后的安装程序；沿用原安装位置，保留已有配对、队列和同步文件。程序与 _internal 文件夹需一起保留。</p>
  </section>
</template>

<style scoped>
.assistant-download{margin-bottom:20px}.assistant-download-heading{display:flex;align-items:center;justify-content:space-between;gap:20px}.assistant-download h2{margin:0 0 8px;font-size:18px}.assistant-download p{line-height:1.7;margin:8px 0}.assistant-download-heading>div{min-width:0}.assistant-download-heading>a{flex-shrink:0;min-height:40px}.assistant-release-meta,.assistant-update-help,.assistant-download details{color:var(--color-text-muted);font-size:13px}.assistant-download summary{cursor:pointer}.assistant-download code{display:block;overflow-wrap:anywhere;user-select:all;margin-top:8px}.assistant-download-error{color:var(--color-danger)}@media(max-width:600px){.assistant-download-heading{align-items:stretch;flex-direction:column;gap:8px}.assistant-download-heading>a,.assistant-download-heading>button{min-height:44px}}
</style>
