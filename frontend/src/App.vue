<script setup lang="ts">
import { Button as AButton } from 'ant-design-vue'
import { ConfigProvider as AConfigProvider } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'

import { onBeforeUnmount, onMounted, ref } from 'vue'
import AuthView from './modules/auth/AuthView.vue'
import WorkspaceView from './modules/note/WorkspaceView.vue'
import { api, refreshCsrf, type AuthStatus } from './shared/api/client'
import { onSessionExpired, setAuthenticatedSession } from './shared/api/session'
import BrandMark from './shared/BrandMark.vue'
import { loadServerTheme, themeAccent } from './modules/settings/server-appearance'

const account = ref<AuthStatus>()
const error = ref('')
const loading = ref(false)
const workspace = ref<InstanceType<typeof WorkspaceView>>()
const expiring = ref(false)
const loginNotice = ref('')
function authenticated(status: AuthStatus) {
  if (status.authenticated) void loadServerTheme()
  setAuthenticatedSession(status.authenticated)
  account.value = status
  loginNotice.value = ''
  error.value = ''
}
async function expireSession() {
  if (expiring.value || !account.value?.authenticated) return
  expiring.value = true
  setAuthenticatedSession(false)
  let stored = false
  try { stored = await (workspace.value?.prepareSessionExpiry() ?? Promise.resolve(true)) }
  catch { stored = false }
  finally {
    account.value = { initialized: true, authenticated: false, username: null }
    error.value = ''
    loginNotice.value = stored ? '登录已失效，请重新登录。' : '登录已失效，请重新登录。最新草稿未能确认暂存，可能丢失最新输入；上次成功暂存的草稿仍保留。'
    expiring.value = false
  }
}
const unsubscribe = onSessionExpired(() => { void expireSession() })
async function load() {
  loading.value = true
  error.value = ''
  try {
    const status = await api<AuthStatus>('/auth/status')
    if (account.value?.authenticated && !status.authenticated) await expireSession()
    else authenticated(status)
    await refreshCsrf()
  } catch { error.value = '无法连接服务，请确认后端和数据库已启动，再重新连接。' }
  finally { loading.value = false }
}
async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' })
    authenticated({ initialized: true, authenticated: false, username: null })
    await load()
  } catch { if (account.value?.authenticated && !expiring.value) error.value = '退出未完成，请检查连接后重试。' }
}
onMounted(load)
onBeforeUnmount(unsubscribe)
</script>

<template>
  <AConfigProvider :locale="zhCN" :auto-insert-space-in-button="false" :theme="{ token: { colorPrimary: account?.authenticated ? themeAccent : '#526b83', colorText: '#302f2d', colorTextSecondary: '#716e68', colorBorder: '#e7e5df', colorBgLayout: '#f7f6f3', colorBgContainer: '#ffffff', borderRadius: 8, fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Microsoft YaHei, sans-serif' } }">
  <div v-if="error" class="connection-alert" role="alert">{{ error }}<AButton :disabled="loading" @click="load">重新连接</AButton></div>
  <WorkspaceView v-if="account?.authenticated" ref="workspace" :inert="expiring || undefined" :username="account.username!" @logout="logout" @session-expired="expireSession" />
  <AuthView v-else-if="account" :initialized="account.initialized" :notice="loginNotice" @authenticated="authenticated" />
  <main v-else class="connection-page"><BrandMark /><h1>私有空间</h1><p role="status">{{ error ? '等待连接账户服务' : '正在连接账户服务…' }}</p></main>
  </AConfigProvider>
</template>
