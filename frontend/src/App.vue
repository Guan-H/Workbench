<script setup lang="ts">
import { Button as AButton } from 'ant-design-vue'
import { ConfigProvider as AConfigProvider } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'

import { onMounted, ref } from 'vue'
import AuthView from './modules/auth/AuthView.vue'
import WorkspaceView from './modules/note/WorkspaceView.vue'
import { api, refreshCsrf, type AuthStatus } from './shared/api/client'

const account = ref<AuthStatus>()
const error = ref('')
const loading = ref(false)
async function load() {
  loading.value = true
  error.value = ''
  try {
    account.value = await api<AuthStatus>('/auth/status')
    await refreshCsrf()
  } catch { error.value = '无法连接服务，请确认后端和数据库已启动，再重新连接。' }
  finally { loading.value = false }
}
async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' })
    await load()
  } catch { error.value = '退出未完成，请检查连接后重试。' }
}
onMounted(load)
</script>

<template>
  <AConfigProvider :locale="zhCN" :auto-insert-space-in-button="false" :theme="{ token: { colorPrimary: '#39765b', colorText: '#252a28', colorBorder: '#e1e6e1', borderRadius: 6, fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Microsoft YaHei, sans-serif' } }">
  <div v-if="error" class="connection-alert" role="alert">{{ error }}<AButton :disabled="loading" @click="load">重新连接</AButton></div>
  <WorkspaceView v-if="account?.authenticated" :username="account.username!" @logout="logout" @session-expired="load" />
  <AuthView v-else-if="account" :initialized="account.initialized" @authenticated="account = $event" />
  <main v-else class="connection-page"><div class="brand-mark">私</div><h1>私有空间</h1><p role="status">{{ error ? '等待连接账户服务' : '正在连接账户服务…' }}</p></main>
  </AConfigProvider>
</template>
