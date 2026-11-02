<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Copy, Monitor, RefreshCw, ShieldOff } from 'lucide-vue-next'
import { api, write } from '../../shared/api/client'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'

interface SyncDevice { id: string; name: string; revoked: boolean; createdAt: string; lastSeenAt: string | null }
const devices = ref<SyncDevice[]>([])
const loading = ref(true)
const busy = ref(false)
const problem = ref('')
const listError = ref('')
const feedback = ref('')
const name = ref('我的电脑')
const pairing = ref<{ code: string; deadline: number }>()
const now = ref(Date.now())
const revokeTarget = ref<SyncDevice>()
const page = ref(0)
const pageSize = 10
const pages = computed(() => Math.max(1, Math.ceil(devices.value.length / pageSize)))
const rows = computed(() => devices.value.slice(page.value * pageSize, (page.value + 1) * pageSize))
const seconds = computed(() => Math.max(0, Math.ceil(((pairing.value?.deadline ?? 0) - now.value) / 1000)))
const timeFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' })
let alive = true
const timer = setInterval(() => {
  now.value = Date.now()
  if (pairing.value && now.value >= pairing.value.deadline) pairing.value = undefined
}, 1000)

function time(value: string | null) { return value ? timeFormat.format(new Date(value)) : '尚未联系' }
function message(cause: unknown) { return cause instanceof Error ? cause.message : '设备操作失败，请重试。' }
async function refresh() {
  loading.value = true
  listError.value = ''
  try {
    const result = await api<SyncDevice[]>('/sync-devices')
    if (alive) { devices.value = result; page.value = Math.min(page.value, pages.value - 1) }
  } catch (cause) { if (alive) listError.value = message(cause) }
  finally { if (alive) loading.value = false }
}
async function createPairing() {
  busy.value = true
  problem.value = ''; feedback.value = ''; pairing.value = undefined
  try {
    const result = await write<{ code: string; expiresInSeconds: string }>('/sync-devices/pairing-code', 'POST', { name: name.value.trim() })
    if (alive) {
      now.value = Date.now()
      pairing.value = { code: result.code, deadline: now.value + Number(result.expiresInSeconds) * 1000 }
    }
  } catch (cause) { if (alive) problem.value = message(cause) }
  finally { if (alive) busy.value = false }
}
async function copyCode() {
  if (!pairing.value || seconds.value === 0) return
  try { await navigator.clipboard.writeText(pairing.value.code); feedback.value = '配对码已复制。' }
  catch { problem.value = '无法访问剪贴板，请手动选择并复制配对码。' }
}
async function revoke(accepted: boolean) {
  const target = revokeTarget.value
  revokeTarget.value = undefined
  if (!accepted || !target) return
  busy.value = true; problem.value = ''; feedback.value = ''
  try {
    await write('/sync-devices/' + target.id, 'DELETE')
    if (alive) { feedback.value = '设备授权已撤销，后续同步请求将被拒绝。'; await refresh() }
  } catch (cause) { if (alive) problem.value = message(cause) }
  finally { if (alive) busy.value = false }
}
onMounted(() => { void refresh() })
onBeforeUnmount(() => { alive = false; clearInterval(timer); pairing.value = undefined })
</script>

<template>
  <section class="sync-content" aria-labelledby="sync-title">
    <header class="sync-page-heading"><div><h1 id="sync-title">同步中心</h1><p>配对 Windows 助手，管理普通笔记的设备授权。</p></div><button :disabled="loading || busy" @click="refresh"><RefreshCw :size="16" aria-hidden="true" />刷新设备</button></header>
    <p class="sync-scope">首批同步入口：当前助手仅接受新空目录，使用最多 5000 对象的全量快照。非空目录合并、增量同步和完整冲突处理仍在后续开发。</p>
    <p v-if="problem" class="error-message" role="alert">{{ problem }}</p>
    <p v-if="listError" class="error-message" role="alert">{{ listError }}</p>
    <p v-if="feedback" role="status" class="sync-feedback">{{ feedback }}</p>
    <section class="home-card sync-pairing" aria-labelledby="pairing-title">
      <h2 id="pairing-title">添加设备</h2>
      <p>生成配对码，在 Windows 助手中填写服务器地址、选择新空目录后完成配对。配对本身不会上传或下载文件。</p>
      <form @submit.prevent="createPairing">
        <div><label for="sync-device-name">设备名称</label><input id="sync-device-name" v-model="name" maxlength="80" required :disabled="busy" autocomplete="off" /></div>
        <button class="primary" :disabled="busy || !name.trim()">{{ busy ? '正在处理…' : '生成配对码' }}</button>
      </form>
      <div v-if="pairing" class="sync-pairing-code">
        <label for="sync-pairing-code">一次性配对码</label>
        <div><output id="sync-pairing-code" data-testid="pairing-code">{{ pairing.code }}</output><button @click="copyCode"><Copy :size="15" aria-hidden="true" />复制</button></div>
        <p role="status">约 {{ seconds }} 秒后过期，仅可使用一次。配对码不保存在浏览器持久化存储中。</p>
      </div>
    </section>
    <section class="home-card sync-devices" aria-labelledby="devices-title">
      <header class="home-card-heading"><h2 id="devices-title"><Monitor :size="18" aria-hidden="true" />已配对设备</h2><span>共 {{ devices.length }} 台</span></header>
      <p class="sync-contact-note">“已授权”不表示在线；最近联系仅是服务端最后收到有效设备请求的时间，不代表文件已全部同步。</p>
      <p v-if="loading" role="status">正在读取设备…</p>
      <p v-else-if="listError && !devices.length">设备列表未能加载，请刷新重试。</p>
      <p v-else-if="!devices.length">还没有配对设备。</p>
      <div v-else class="sync-device-scroll" tabindex="0" aria-label="设备列表">
        <table class="sync-device-table"><thead><tr><th scope="col">设备名称</th><th scope="col">授权状态</th><th scope="col">创建时间</th><th scope="col">最近联系</th><th scope="col">操作</th></tr></thead>
          <tbody><tr v-for="device in rows" :key="device.id" :data-sync-device="device.id"><td>{{ device.name }}</td><td>{{ device.revoked ? '已撤销' : '已授权' }}</td><td>{{ time(device.createdAt) }}</td><td>{{ time(device.lastSeenAt) }}</td><td><button :disabled="device.revoked || busy" :aria-label="'撤销设备 ' + device.name" @click="revokeTarget = device"><ShieldOff :size="15" aria-hidden="true" />撤销授权</button></td></tr></tbody>
        </table>
      </div>
      <footer class="sync-pagination"><button :disabled="page === 0 || loading" @click="page--">上一页</button><span>第 {{ page + 1 }} / {{ pages }} 页 · 每页 {{ pageSize }} 台</span><button :disabled="page + 1 >= pages || loading" @click="page++">下一页</button></footer>
    </section>
    <ConfirmDialog v-if="revokeTarget" title="撤销设备授权" :message="`确定撤销“${revokeTarget.name}”吗？已有本地文件不会被删除，设备后续同步需要重新配对。`" confirm-label="撤销授权" @answer="revoke" />
  </section>
</template>
