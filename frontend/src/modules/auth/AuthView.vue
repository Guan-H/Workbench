<script setup lang="ts">
import { ref } from 'vue'
import { ArrowRight, LockKeyhole, NotebookPen, FolderSync, ShieldCheck } from 'lucide-vue-next'
import { api, refreshCsrf, type AuthStatus } from '../../shared/api/client'

const props = defineProps<{ initialized: boolean }>()
const emit = defineEmits<{ authenticated: [status: AuthStatus] }>()
const username = ref('')
const password = ref('')
const confirmation = ref('')
const setupToken = ref('')
const busy = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  if (!props.initialized && password.value !== confirmation.value) { error.value = '两次输入的登录口令不一致。'; return }
  busy.value = true
  try {
    const status = await api<AuthStatus>(props.initialized ? '/auth/login' : '/auth/initialize', {
      method: 'POST', body: JSON.stringify({ username: username.value, password: password.value, setupToken: setupToken.value }),
    })
    password.value = ''
    confirmation.value = ''
    setupToken.value = ''
    await refreshCsrf()
    emit('authenticated', status)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '无法连接服务，请重试。' }
  finally { busy.value = false }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-intro">
      <div class="brand"><span class="brand-mark"><NotebookPen :size="22" /></span><strong>私有空间</strong></div>
      <div class="intro-copy"><p class="eyebrow">A SPACE OF YOUR OWN</p><h1>把想法留下，<br />把空间留给自己。</h1><p>笔记、文件与重要信息，<br />在属于你的地方，有条不紊。</p></div>
      <div class="intro-features"><span><NotebookPen :size="18" />自由书写</span><span><FolderSync :size="18" />文件随行</span><span><ShieldCheck :size="18" />私人空间</span></div>
      <p class="intro-footnote">PRIVATE SPACE · 个人工作台</p>
    </section>
    <section class="auth-form-area">
      <form class="auth-form" @submit.prevent="submit" :aria-busy="busy">
        <span class="section-label"><LockKeyhole :size="16" />你的私人工作台</span>
        <h2>{{ initialized ? '欢迎回来' : '建立你的私有空间' }}</h2>
        <p class="form-description">{{ initialized ? '登录后，继续上次的思考与记录。' : '创建唯一的管理员账户。完成后，初始化入口将自动关闭。' }}</p>
        <label for="username">用户名</label><input id="username" v-model="username" autocomplete="username" required maxlength="80" placeholder="输入用户名" :disabled="busy" />
        <label for="password">登录口令</label><input id="password" v-model="password" type="password" :autocomplete="initialized ? 'current-password' : 'new-password'" :minlength="initialized ? 1 : 12" required maxlength="72" placeholder="输入登录口令" :disabled="busy" />
        <template v-if="!initialized">
          <p class="field-help">至少 12 个字符。这是账户登录口令，与未来的保险库主密码分开管理。</p>
          <label for="confirmation">确认登录口令</label><input id="confirmation" v-model="confirmation" type="password" autocomplete="new-password" required :disabled="busy" />
          <label for="setupToken">一次性初始化凭证</label><input id="setupToken" v-model="setupToken" type="password" autocomplete="off" required :disabled="busy" />
          <p class="field-help">本机启动时生成于项目的 deploy/setup-token.local 文件。仅用于首次建立账户。</p>
        </template>
        <p v-if="error" class="error-message" role="alert">{{ error }}</p>
        <button class="primary auth-submit" type="submit" :disabled="busy">{{ busy ? '正在处理…' : initialized ? '进入私有空间' : '创建并进入' }}<ArrowRight :size="18" /></button>
        <p class="login-note">首版为单用户空间，不提供公开注册。<br />当前为本机开发版本，公网二次验证将在后续安全阶段启用。</p>
      </form>
    </section>
  </main>
</template>
