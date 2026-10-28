<script setup lang="ts">
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
  <div v-if="error" class="connection-alert" role="alert">{{ error }}<button :disabled="loading" @click="load">重新连接</button></div>
  <WorkspaceView v-if="account?.authenticated" :username="account.username!" @logout="logout" />
  <AuthView v-else-if="account" :initialized="account.initialized" @authenticated="account = $event" />
  <main v-else class="connection-page"><div class="brand-mark">私</div><h1>私有空间</h1><p role="status">{{ error ? '等待连接账户服务' : '正在连接账户服务…' }}</p></main>
</template>
