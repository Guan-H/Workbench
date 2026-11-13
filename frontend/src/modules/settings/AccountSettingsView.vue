<script setup lang="ts">
import { Button as AButton, Table as ATable, Tag as ATag, Tabs as ATabs, TabPane as ATabPane } from 'ant-design-vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RefreshCw, ShieldOff } from 'lucide-vue-next'
import { api, ApiError } from '../../shared/api/client'
import AppMessage, { type Notice } from '../../shared/AppMessage.vue'
import AppPagination from '../../shared/AppPagination.vue'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'
import PasswordGenerator from '../vault/PasswordGenerator.vue'
import EnglishWebhookSettings from '../english/EnglishWebhookSettings.vue'
import AppearanceSettings from './AppearanceSettings.vue'

interface LoginSession { id: string; current: boolean; createdAt: string; expiresAt: string }
const emit = defineEmits<{ sessionExpired: [] }>()
const sessions = ref<LoginSession[]>([])
const loading = ref(false)
const revoking = ref(false)
const error = ref('')
const expired = ref(false)
const target = ref<LoginSession>()
const feedback = ref<Notice>()
const page = ref(1)
const pageSize = 10
const pages = computed(() => Math.max(1, Math.ceil(sessions.value.length / pageSize)))
const rows = computed(() => sessions.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const lifecycle = new AbortController()
let feedbackTimer: ReturnType<typeof setTimeout> | undefined
const columns = [
  { key: 'session', title: '登录会话', width: 160 },
  { key: 'created', title: '登录时间', width: 200 },
  { key: 'expires', title: '到期时间', width: 200 },
  { key: 'actions', title: '操作', width: 160 },
]
const format = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Shanghai' })
function time(value: string) { return format.format(new Date(value)) }
function notify(text: string, duration = 4000) {
  clearTimeout(feedbackTimer)
  feedback.value = { kind: 'success', text }
  feedbackTimer = setTimeout(() => { feedback.value = undefined }, duration)
}
function fail(cause: unknown, fallback: string) {
  expired.value = cause instanceof ApiError && cause.status === 401
  error.value = expired.value ? '当前登录已失效，请重新登录。' : cause instanceof Error ? `${fallback} ${cause.message}` : fallback
}
async function load(showFeedback = false) {
  loading.value = true; error.value = ''; expired.value = false
  try {
    const result = await api<LoginSession[]>('/auth/sessions', { signal: lifecycle.signal })
    if (lifecycle.signal.aborted) return
    sessions.value = result; page.value = Math.min(page.value, pages.value)
    if (showFeedback) notify('刷新成功', 2000)
  } catch (cause) { if (!lifecycle.signal.aborted) fail(cause, '读取登录会话失败，请重试。') }
  finally { if (!lifecycle.signal.aborted) loading.value = false }
}
async function refresh() { if (!loading.value && !revoking.value) await load(true) }
async function revoke(accepted: boolean) {
  const selected = target.value
  target.value = undefined
  if (!accepted || !selected || selected.current || revoking.value) return
  revoking.value = true; error.value = ''; feedback.value = undefined
  try {
    const result = await api<{ revoked: number }>(`/auth/sessions/${encodeURIComponent(selected.id)}`, { method: 'DELETE', signal: lifecycle.signal })
    if (lifecycle.signal.aborted) return
    await load()
    if (!lifecycle.signal.aborted) notify(result.revoked ? '会话已撤销，下次请求需重新登录。' : '该会话已失效，列表已更新。')
  } catch (cause) { if (!lifecycle.signal.aborted) fail(cause, '撤销结果尚未确认，请刷新列表核对后重试。') }
  finally { if (!lifecycle.signal.aborted) revoking.value = false }
}
onMounted(() => { void load() })
onBeforeUnmount(() => { lifecycle.abort(); clearTimeout(feedbackTimer) })
</script>

<template>
  <section class="settings-content" aria-labelledby="settings-title">
    <header class="settings-heading">
      <div><h1 id="settings-title">设置</h1><p>管理当前浏览器的外观偏好与账户安全。</p></div>
      <AButton :disabled="loading || revoking" :aria-busy="loading" @click="refresh"><RefreshCw :size="16" :class="{ 'message-loading': loading }" aria-hidden="true" />{{ loading ? '正在刷新…' : '刷新会话' }}</AButton>
    </header>
    <AppMessage :notice="feedback" @close="feedback = undefined" />
    <p v-if="error" class="error-message" role="alert">{{ error }} <AButton v-if="expired" @click="emit('sessionExpired')">重新登录</AButton></p>
    <ATabs>
    <ATabPane key="appearance" tab="外观"><AppearanceSettings /></ATabPane>
    <ATabPane key="account" tab="账户安全">
    <section class="home-card account-sessions" aria-labelledby="sessions-title">
      <header class="home-card-heading"><h2 id="sessions-title">网页登录会话</h2><span>共 {{ sessions.length }} 个有效会话</span></header>
      <p class="field-help">按登录时间核对其他会话。撤销后，该会话下次访问私有接口时会被拒绝；当前会话请通过左侧“退出登录”结束。时间以北京时间显示。</p>
      <p class="field-help">未记录浏览器类型、IP 或实时在线状态，请勿将这里的会话数量理解为在线设备数量。</p>
      <p v-if="loading" role="status">正在读取登录会话…</p>
      <ATable v-else :columns="columns" :data-source="rows" row-key="id" :pagination="false" size="small" :scroll="{ x: 720, y: 'min(420px, 50dvh)' }" :custom-row="(session: LoginSession) => ({ class: 'login-session-row', 'data-login-session': session.id })">
        <template #bodyCell="{ column, record }">
          <template v-for="session in rows.filter(item => item.id === record.id)" :key="session.id">
            <template v-if="column.key === 'session'"><ATag v-if="session.current" color="green">当前会话</ATag><span v-else>其他会话</span></template>
            <template v-else-if="column.key === 'created'">{{ time(session.createdAt) }}</template>
            <template v-else-if="column.key === 'expires'">{{ time(session.expiresAt) }}</template>
            <template v-else-if="column.key === 'actions'"><AButton :disabled="session.current || revoking || expired" :aria-label="session.current ? '当前会话请使用退出登录' : '撤销会话 ' + session.id" @click="target = session"><ShieldOff :size="15" aria-hidden="true" />撤销会话</AButton></template>
          </template>
        </template>
      </ATable>
      <nav class="pagination device-pagination" aria-label="登录会话分页">
        <span class="pagination-summary">共 {{ sessions.length }} 个 · 第 {{ page }} 页 / 共 {{ pages }} 页 · {{ pageSize }} 个/页</span>
        <AppPagination v-model:page="page" :pages="pages" :total="sessions.length" :page-size="pageSize" :disabled="loading || revoking" />
      </nav>
    </section>
    </ATabPane>
    <ATabPane key="webhook" tab="Webhook"><EnglishWebhookSettings /></ATabPane>
    <ATabPane key="tools" tab="密码工具"><PasswordGenerator /></ATabPane>
    </ATabs>
    <ConfirmDialog v-if="target" title="撤销登录会话" :message="`确定撤销 ${time(target.createdAt)} 建立的会话吗？该会话下次访问私有内容时需要重新登录。`" confirm-label="确认撤销" @answer="revoke" />
  </section>
</template>
