<script setup lang="ts">
import AppPagination from '../../shared/AppPagination.vue'
import { Table as ATable, Button as AButton, Input as AInput } from 'ant-design-vue'
import AppDialog from '../../shared/AppDialog.vue'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Copy, Monitor, RefreshCw, ShieldOff } from 'lucide-vue-next'
import { api, write, listNotes, type Note } from '../../shared/api/client'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'
import AppMessage from '../../shared/AppMessage.vue'
import SyncScopePicker, { type SyncScope } from './SyncScopePicker.vue'
import SyncConflictPanel from './SyncConflictPanel.vue'
import SyncAssistantDownload from './SyncAssistantDownload.vue'

interface SyncDevice { id: string; name: string; revoked: boolean; createdAt: string; lastSeenAt: string | null; scope: SyncScope; scopeVersion: string }
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
const scope = ref<SyncScope>({ all: true, folders: [] })
const folders = ref<Note[]>([])
const folderError = ref('')
const editing = ref<SyncDevice>()
const conflictDevice = ref<SyncDevice>()
const editedScope = ref<SyncScope>({ all: true, folders: [] })
const scopeError = ref('')
const scopePanel = ref<HTMLElement>()
let previous: HTMLElement | null = null
const pageSize = 10
const pages = computed(() => Math.max(1, Math.ceil(devices.value.length / pageSize)))
const rows = computed(() => devices.value.slice(page.value * pageSize, (page.value + 1) * pageSize))
const seconds = computed(() => Math.max(0, Math.ceil(((pairing.value?.deadline ?? 0) - now.value) / 1000)))
const timeFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' })
let alive = true
let messageTimer: ReturnType<typeof setTimeout> | undefined
let messageDuration = 4000
function notify(text: string, duration = 4000) {
  messageDuration = duration
  feedback.value = text
}
watch(feedback, value => {
  clearTimeout(messageTimer)
  if (value) messageTimer = setTimeout(() => { feedback.value = '' }, messageDuration)
})
const timer = setInterval(() => {
  now.value = Date.now()
  if (pairing.value && now.value >= pairing.value.deadline) pairing.value = undefined
}, 1000)

function time(value: string | null) { return value ? timeFormat.format(new Date(value)) : '尚未联系' }
function message(cause: unknown) { return cause instanceof Error ? cause.message : '设备操作失败，请重试。' }
async function refresh(showFeedback = false) {
  loading.value = true
  listError.value = ''
  if (showFeedback) feedback.value = ''
  try {
    const result = await api<SyncDevice[]>('/sync-devices')
    if (alive) {
      devices.value = result; page.value = Math.min(page.value, pages.value - 1)
      if (conflictDevice.value) conflictDevice.value = result.find(item => item.id === conflictDevice.value?.id)
    }
    try { const catalog = await listNotes(); if (alive) { folders.value = catalog; folderError.value = '' } }
    catch (cause) { if (alive) folderError.value = message(cause) }
    if (alive && showFeedback) notify(folderError.value ? '设备已刷新，目录加载失败，请重试。' : '刷新成功', 2000)
  } catch (cause) { if (alive) listError.value = message(cause) }
  finally { if (alive) loading.value = false }
}
async function createPairing() {
  busy.value = true
  problem.value = ''; feedback.value = ''; pairing.value = undefined
  try {
    const result = await write<{ code: string; expiresInSeconds: string }>('/sync-devices/pairing-code', 'POST', { name: name.value.trim(), scope: scope.value })
    if (alive) {
      now.value = Date.now()
      pairing.value = { code: result.code, deadline: now.value + Number(result.expiresInSeconds) * 1000 }
    }
  } catch (cause) { if (alive) problem.value = message(cause) }
  finally { if (alive) busy.value = false }
}
async function copyCode() {
  if (!pairing.value || seconds.value === 0) return
  try { await navigator.clipboard.writeText(pairing.value.code); notify('配对码已复制。') }
  catch { problem.value = '无法访问剪贴板，请手动选择并复制配对码。' }
}
async function revoke(accepted: boolean) {
  const target = revokeTarget.value
  revokeTarget.value = undefined
  if (!accepted || !target) return
  busy.value = true; problem.value = ''; feedback.value = ''
  try {
    await write('/sync-devices/' + target.id, 'DELETE')
    if (alive) { notify('设备授权已撤销，后续同步请求将被拒绝。'); await refresh() }
  } catch (cause) { if (alive) problem.value = message(cause) }
  finally { if (alive) busy.value = false }
}
async function editScope(device: SyncDevice) {
  previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  editing.value = device
  editedScope.value = { all: device.scope.all, folders: [...device.scope.folders] }
  scopeError.value = ''
  await nextTick(); scopePanel.value?.querySelector<HTMLElement>('button')?.focus()
}
function closeScope() { if (!busy.value) { editing.value = undefined; previous?.focus() } }
function scopeKey(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape') closeScope()
  if (event.key !== 'Tab') return
  const controls = [...(scopePanel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])]
  if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
  else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
}
async function saveScope() {
  if (!editing.value) return
  busy.value = true; scopeError.value = ''
  try {
    await write('/sync-devices/' + editing.value.id + '/scope', 'PUT', { scope: editedScope.value, baseVersion: editing.value.scopeVersion })
    if (alive) { editing.value = undefined; notify('同步范围已保存。助手下一次对账应用新范围，未选文件保留，重新纳入的路径不依据旧基线推断删除。'); await refresh(); previous?.focus() }
  } catch (cause) { if (alive) scopeError.value = message(cause) }
  finally { if (alive) busy.value = false }
}
onMounted(() => { void refresh() })
onBeforeUnmount(() => { alive = false; clearInterval(timer); clearTimeout(messageTimer); pairing.value = undefined })
</script>

<template>
  <section class="sync-content" aria-labelledby="sync-title">
    <header class="sync-page-heading"><div><h1 id="sync-title">同步中心</h1><p>配对 Windows 助手，管理普通笔记的设备授权。</p></div><AButton :disabled="loading || busy" :aria-busy="loading" @click="refresh(true)"><RefreshCw :size="16" :class="{ 'message-loading': loading }" aria-hidden="true" />{{ loading ? '正在刷新…' : '刷新设备' }}</AButton></header>
    <p class="sync-scope">请使用与服务器配套的助手版本。冲突记录来自助手实际成功上报；旧版或尚未上报的设备不能据此判断没有冲突。</p>
    <SyncAssistantDownload />
    <p v-if="problem" class="error-message" role="alert">{{ problem }}</p>
    <p v-if="listError" class="error-message" role="alert">{{ listError }}</p>
    <AppMessage :notice="feedback ? { kind: 'info', text: feedback } : undefined" @close="feedback = ''" />
    <section class="home-card sync-pairing" aria-labelledby="pairing-title">
      <h2 id="pairing-title">添加设备</h2>
      <p>生成配对码后，在 Windows 助手中填写服务器地址并选择同步目录。建议使用空目录；已有目录须使用支持合并预检的新版助手。配对本身不会上传或下载文件。</p>
      <form @submit.prevent="createPairing">
        <div><label for="sync-device-name">设备名称</label><AInput id="sync-device-name" v-model:value="name" :maxlength="80" required :disabled="busy" autocomplete="off" /></div>
        <AButton html-type="submit" type="primary" class="primary" :disabled="busy || !name.trim() || !scope.all && (!scope.folders.length || !!folderError)">{{ busy ? '正在处理…' : '生成配对码' }}</AButton>
        <p v-if="folderError" class="error-message" role="alert">目录加载失败：{{ folderError }}</p>
        <SyncScopePicker v-model="scope" :items="folders" :disabled="busy || !!pairing" />
      </form>
      <div v-if="pairing" class="sync-pairing-code">
        <label for="sync-pairing-code">一次性配对码</label>
        <div><output id="sync-pairing-code" data-testid="pairing-code">{{ pairing.code }}</output><AButton @click="copyCode"><Copy :size="15" aria-hidden="true" />复制</AButton></div>
        <p role="status">约 {{ seconds }} 秒后过期，仅可使用一次。配对码不保存在浏览器持久化存储中。</p>
        <AButton html-type="button" @click="pairing = undefined">收起配对码</AButton><p class="field-help">收起仅清除当前显示；已生成的码仍按原范围生效至过期或使用。</p>
      </div>
    </section>
    <section class="home-card sync-devices" aria-labelledby="devices-title">
      <header class="home-card-heading"><h2 id="devices-title"><Monitor :size="18" aria-hidden="true" />已配对设备</h2><span>共 {{ devices.length }} 台</span></header>
      <p class="sync-contact-note">“已授权”不表示在线；最近联系仅是服务端最后收到有效设备请求的时间，不代表文件已全部同步。</p>
      <p v-if="loading" role="status">正在读取设备…</p>
      <p v-else-if="listError && !devices.length">设备列表未能加载，请刷新重试。</p>
      <p v-else-if="!devices.length">还没有配对设备。</p>
      <div v-else class="sync-device-scroll" tabindex="0" aria-label="设备列表">
        <ATable :columns='[{"key":"0","title":"设备名称","width":180},{"key":"1","title":"授权状态","width":100},{"key":"2","title":"同步范围","width":240},{"key":"3","title":"创建时间","width":150},{"key":"4","title":"最近联系","width":150},{"key":"5","title":"操作","width":300}]' :data-source="rows" :row-key="device => device.id" :pagination="false" size="small" :scroll="{ x: 1120, y: 'min(420px, 50dvh)' }" :custom-row="(device: SyncDevice) => ({ class: 'sync-record-row', 'data-sync-device': device.id })">
        <template #bodyCell="{ column, record }">
          <template v-for="device in rows.filter(row => row.id === record.id)" :key="device.id">
          <template v-if="column.key === '0'">{{ device.name }}</template>
          <template v-else-if="column.key === '1'">{{ device.revoked ? '已撤销' : '已授权' }}</template>
          <template v-else-if="column.key === '2'">{{ device.scope.all ? '全部同步' : device.scope.folders.join('、') }}</template>
          <template v-else-if="column.key === '3'">{{ time(device.createdAt) }}</template>
          <template v-else-if="column.key === '4'">{{ time(device.lastSeenAt) }}</template>
          <template v-else-if="column.key === '5'"><div class="sync-device-actions"><AButton :aria-label="'查看冲突记录 ' + device.name" :aria-expanded="conflictDevice?.id === device.id" @click="conflictDevice = conflictDevice?.id === device.id ? undefined : device">冲突记录</AButton><AButton :disabled="device.revoked || busy" :aria-label="'修改同步范围 ' + device.name" @click="editScope(device)">修改范围</AButton><AButton :disabled="device.revoked || busy" :aria-label="'撤销设备 ' + device.name" @click="revokeTarget = device"><ShieldOff :size="15" aria-hidden="true" />撤销授权</AButton></div></template>
          </template>
        </template>
      </ATable>
      </div>
      <nav class="pagination device-pagination" aria-label="设备列表分页">
        <span class="pagination-summary">共 {{ devices.length }} 台 · 第 {{ page + 1 }} 页 / 共 {{ pages }} 页 · {{ pageSize }} 台/页</span>
        <AppPagination :page="page + 1" :pages="pages" :total="devices.length" :page-size="pageSize" :disabled="loading" @update:page="page = $event - 1" />
      </nav>
    </section>
    <SyncConflictPanel v-if="conflictDevice" :device="conflictDevice.id" :name="conflictDevice.name" :scope-version="conflictDevice.scopeVersion" :revoked="conflictDevice.revoked" />
    <ConfirmDialog v-if="revokeTarget" title="撤销设备授权" :message="`确定撤销“${revokeTarget.name}”吗？已有本地文件不会被删除，设备后续同步需要重新配对。`" confirm-label="撤销授权" @answer="revoke" />
    <AppDialog label="修改同步范围" wide v-if="editing"><section ref="scopePanel" class="modal wide-modal"    @keydown="scopeKey"><header><h2>修改同步范围 · {{ editing.name }}</h2><AButton :disabled="busy" @click="closeScope">关闭</AButton></header><form @submit.prevent="saveScope"><p>修改只影响本设备。取消勾选仅停止同步，两端已有文件保留。重新纳入时保留本地修改并重新核对，不按旧删除基线执行。</p><SyncScopePicker v-model="editedScope" :items="folders" :disabled="busy" /><p v-if="scopeError" class="error-message" role="alert">{{ scopeError }}</p><footer><AButton html-type="button" :disabled="busy" @click="closeScope">取消</AButton><AButton html-type="submit" type="primary" class="primary" :disabled="busy || !editedScope.all && (!editedScope.folders.length || !!folderError)">保存范围</AButton></footer></form></section></AppDialog>
  </section>
</template>
