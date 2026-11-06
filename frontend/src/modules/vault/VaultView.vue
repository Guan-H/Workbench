<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Card as ACard, Checkbox as ACheckbox, Form as AForm, FormItem as AFormItem, Input as AInput, Spin as ASpin, Tag as ATag, Tooltip as ATooltip } from 'ant-design-vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Info, KeyRound, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-vue-next'
import { api, ApiError } from '../../shared/api/client'
import AppMessage, { type Notice } from '../../shared/AppMessage.vue'
import type { VaultEnvelope } from './envelope'
import { VaultWorker } from './worker-client'
import ChangeMasterPasswordDialog from './ChangeMasterPasswordDialog.vue'
import VaultEntriesView from './VaultEntriesView.vue'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'
import type { SavedVault } from './types'
import type { VaultEntry } from './entries'

type VaultStatus = SavedVault | { initialized: false }
type Phase = 'loading' | 'new' | 'locked' | 'locking' | 'unlocked' | 'unavailable'
const phase = ref<Phase>('loading')
const saved = ref<SavedVault>()
const password = ref('')
const confirmation = ref('')
const acknowledged = ref(false)
const busy = ref(false)
const problem = ref('')
const feedback = ref<Notice>()
const worker = new VaultWorker()
const pending = ref<{ envelope: VaultEnvelope; operation: string }>()
const changeOpen = ref(false)
const pendingChange = ref<{ envelope: VaultEnvelope; operation: string; baseVersion: string }>()
const openedEntries = ref<VaultEntry[]>([])
const entriesView = ref<InstanceType<typeof VaultEntriesView>>()
const entryState = ref({ editing: false, working: false })
const leaveConfirmation = ref<{ answer: (accepted: boolean) => void }>()
let locking: Promise<boolean> | undefined
let serial = 0
let feedbackTimer: ReturnType<typeof setTimeout> | undefined
let lastActivity = 0
let idleTimer: ReturnType<typeof setInterval> | undefined
function notify(text: string) {
  clearTimeout(feedbackTimer); feedback.value = { kind: 'info', text }
  feedbackTimer = setTimeout(() => { feedback.value = undefined }, 4000)
}
function forgetPasswords() { password.value = ''; confirmation.value = '' }
function forceLock(reason = '') {
  serial++; worker.lock(); forgetPasswords(); busy.value = false; changeOpen.value = false
  openedEntries.value = []; entryState.value = { editing: false, working: false }
  if (saved.value) phase.value = 'locked'
  if (reason) notify(reason)
}
async function lock(reason = '保险库已锁定。') {
  if (locking) return locking
  if (phase.value !== 'unlocked') { forceLock(reason); return true }
  serial++
  const flushing = entriesView.value?.flushDraft() ?? Promise.resolve(true)
  phase.value = 'locking'; openedEntries.value = []; changeOpen.value = false; forgetPasswords(); busy.value = true
  const task = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const stored = await Promise.race([flushing, new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 1500) })]).catch(() => false)
      forceLock(reason)
      if (!stored) problem.value = '已锁定，但最新草稿未能确认暂存，可能丢失最新输入；上次成功加密的草稿仍保留。'
      return stored
    } finally { clearTimeout(timer); locking = undefined }
  })()
  locking = task
  return task
}
async function prepareLeave(): Promise<boolean> {
  if (locking) { await locking; return true }
  if (phase.value !== 'unlocked') return true
  const stored = await (entriesView.value?.flushDraft() ?? Promise.resolve(true))
  if (!stored) {
    const accepted = await new Promise<boolean>(resolve => { leaveConfirmation.value = { answer: result => { leaveConfirmation.value = undefined; resolve(result) } } })
    if (!accepted) return false
  }
  forceLock(''); return true
}
function encryptionFailure(text: string) { forceLock(''); problem.value = text }
function entriesStored(snapshot: SavedVault, entries: VaultEntry[]) { saved.value = snapshot; openedEntries.value = entries }
async function load() {
  if (phase.value === 'unlocked' && !await prepareLeave()) return
  const expected = ++serial
  worker.lock(); forgetPasswords(); changeOpen.value = false; busy.value = true; problem.value = ''; phase.value = 'loading'
  try {
    const result = await api<VaultStatus>('/vault', { signal: AbortSignal.timeout(30000) })
    if (expected !== serial) return
    if (result.initialized) {
      saved.value = result; phase.value = 'locked'; pending.value = undefined
      if (pendingChange.value) notify('已重新读取保险库，请核对主密码修改结果，再使用对应主密码解锁。')
      pendingChange.value = undefined
    }
    else { saved.value = undefined; phase.value = 'new' }
  } catch (cause) {
    if (expected === serial) { phase.value = 'unavailable'; problem.value = cause instanceof Error ? cause.message : '读取保险库失败，请重试。' }
  } finally { if (expected === serial) busy.value = false }
}
async function create() {
  if (busy.value || phase.value !== 'new') return
  if (!pending.value && (!acknowledged.value || [...password.value].length < 12 || new TextEncoder().encode(password.value).length > 1024 || password.value !== confirmation.value)) {
    problem.value = '主密码至少 12 个字符、UTF-8 不超过 1024 字节，两次输入必须一致，并确认已了解说明。'; return
  }
  const expected = ++serial
  busy.value = true; problem.value = ''
  try {
    if (!pending.value) {
      const command = { kind: 'create', password: password.value } as const
      forgetPasswords()
      const result = await worker.request(command)
      if (expected !== serial) return
      if (result.kind !== 'created') throw new Error('创建加密内容失败，请重试。')
      pending.value = { envelope: result.envelope, operation: crypto.randomUUID() }
    }
    const creating = pending.value
    if (!creating) return
    const result = await api<SavedVault>('/vault', { method: 'POST', body: JSON.stringify({ envelope: creating.envelope }), headers: { 'Idempotency-Key': creating.operation }, signal: AbortSignal.timeout(30000) })
    if (expected !== serial) return
    if (!result.initialized || result.vaultId !== creating.envelope.vaultId || JSON.stringify(result.envelope) !== JSON.stringify(creating.envelope)) {
      throw new Error('服务器返回的快照未能核对，请刷新后解锁。')
    }
    saved.value = result; pending.value = undefined
    // Always require a fresh unlock after creation: retry may happen after the Worker was discarded.
    worker.lock(); phase.value = 'locked'; notify('保险库已创建，请用主密码解锁核对。')
  } catch (cause) {
    if (expected !== serial) return
    worker.lock()
    if (cause instanceof ApiError && cause.status === 409) {
      pending.value = undefined; await load(); problem.value = '保险库已经存在，原数据未覆盖，请解锁已有保险库。'
    } else problem.value = pending.value ? '创建结果尚未确认，加密快照已在本页保留。请点击“重试确认创建”，或刷新后核对已有保险库。' : '加密创建未完成，请检查主密码或浏览器环境后重试。'
  } finally { if (expected === serial) { busy.value = false; forgetPasswords() } }
}
async function unlock() {
  if (!saved.value || busy.value || pendingChange.value || phase.value !== 'locked' || !password.value) return
  const expected = ++serial
  busy.value = true; problem.value = ''
  const secret = password.value
  forgetPasswords()
  try {
    // Re-read before unlocking so another tab's persisted metadata is never silently replaced.
    const latest = await api<VaultStatus>('/vault', { signal: AbortSignal.timeout(30000) })
    if (expected !== serial) return
    if (!latest.initialized) throw new Error('VAULT_MISSING')
    saved.value = latest
    const result = await worker.request({ kind: 'unlock', password: secret, envelope: latest.envelope, id: latest.vaultId })
    if (expected !== serial) return
    if (result.kind !== 'unlocked') throw new Error('VAULT_REJECTED')
    openedEntries.value = result.entries; phase.value = 'unlocked'; lastActivity = Date.now(); notify('保险库已解锁。')
  } catch {
    if (expected === serial) { worker.lock(); phase.value = 'locked'; problem.value = '无法解锁：主密码不正确、密文异常或浏览器加密操作失败。原数据未改动，请核对后重试。' }
  } finally { if (expected === serial) { busy.value = false; forgetPasswords() } }
}
async function submitMasterChange(expected: number) {
  const changing = pendingChange.value
  if (!changing) return
  try {
    const result = await api<SavedVault>('/vault/master-password', {
      method: 'PUT', body: JSON.stringify({ baseVersion: changing.baseVersion, envelope: changing.envelope }),
      headers: { 'Idempotency-Key': changing.operation }, signal: AbortSignal.timeout(30000),
    })
    if (expected !== serial) return
    if (!result.initialized || result.vaultId !== changing.envelope.vaultId || result.version !== String(BigInt(changing.baseVersion) + 1n)
        || JSON.stringify(result.envelope) !== JSON.stringify(changing.envelope)) throw new Error('VAULT_RESULT_MISMATCH')
    saved.value = result; pendingChange.value = undefined; problem.value = ''
    notify('主密码已修改，保险库已锁定，请用新主密码解锁。')
  } catch (cause) {
    if (expected !== serial) return
    if (cause instanceof ApiError && cause.status === 409) {
      pendingChange.value = undefined
      await load()
      problem.value = '保险库版本已变化，本次修改未覆盖已有数据。请核对最新主密码后重新解锁。'
    } else if (cause instanceof ApiError && cause.status === 400) {
      pendingChange.value = undefined; problem.value = '修改请求被拒绝，原数据未被本次请求改动，请重新读取后核对。'
    } else problem.value = '主密码修改结果尚未确认。请重试确认，或重新读取后核对新旧主密码；不要把网络失败当作修改失败。'
  } finally { if (expected === serial) busy.value = false }
}
async function changeMaster(passwords: { currentPassword: string; newPassword: string }) {
  if (busy.value || phase.value !== 'unlocked' || !saved.value) return
  const base = saved.value
  const expected = ++serial
  busy.value = true; problem.value = ''
  try {
    const command = { kind: 'rewrap' as const, ...passwords }
    passwords.currentPassword = ''; passwords.newPassword = ''
    const task = worker.request(command)
    // postMessage has copied the command; discard the main-thread string references now.
    command.currentPassword = ''; command.newPassword = ''
    const result = await task
    if (expected !== serial) return
    if (result.kind !== 'rewrapped') throw new Error('VAULT_REWRAP_FAILED')
    pendingChange.value = { envelope: result.envelope, operation: crypto.randomUUID(), baseVersion: base.version }
    worker.lock(); forgetPasswords(); changeOpen.value = false; openedEntries.value = []; phase.value = 'locked'
    await submitMasterChange(expected)
  } catch {
    if (expected === serial) {
      lock(''); problem.value = '当前主密码无法核验或加密操作失败，未提交修改，请重新解锁后核对。'
    }
  } finally { if (expected === serial) busy.value = false }
}
async function retryMasterChange() {
  if (busy.value || !pendingChange.value) return
  const expected = ++serial
  busy.value = true; problem.value = ''
  await submitMasterChange(expected)
}
function activity() { if (phase.value === 'unlocked') lastActivity = Date.now() }
function checkIdle() { if (phase.value === 'unlocked' && Date.now() - lastActivity >= 300000) lock('闲置超过 5 分钟，保险库已自动锁定。') }
function leavingPage() { forceLock('') }
function beforeUnload(event: BeforeUnloadEvent) { if (entriesView.value?.hasUnsafeDraft()) { event.preventDefault(); event.returnValue = '' } }
function shortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault(); event.stopPropagation()
    if (!event.repeat && !busy.value) void entriesView.value?.save()
  }
}
onMounted(() => {
  void load(); idleTimer = setInterval(checkIdle, 1000)
  document.addEventListener('pointerdown', activity); document.addEventListener('keydown', activity)
  window.addEventListener('focus', checkIdle); window.addEventListener('pagehide', leavingPage)
  window.addEventListener('beforeunload', beforeUnload)
})
onBeforeUnmount(() => {
  serial++; worker.lock(); forgetPasswords(); pending.value = undefined; pendingChange.value = undefined
  clearInterval(idleTimer); clearTimeout(feedbackTimer)
  document.removeEventListener('pointerdown', activity); document.removeEventListener('keydown', activity)
  window.removeEventListener('focus', checkIdle); window.removeEventListener('pagehide', leavingPage)
  window.removeEventListener('beforeunload', beforeUnload)
  openedEntries.value = []; leaveConfirmation.value?.answer(false)
})
defineExpose({ prepareLeave, lock })
</script>

<template>
  <section class="vault-content" :class="{ 'vault-is-open': phase === 'unlocked' }" aria-labelledby="vault-title" @keydown="shortcut">
    <header class="vault-page-heading">
      <div class="vault-page-title"><span class="vault-title-icon"><ShieldCheck :size="23" :stroke-width="1.6" aria-hidden="true" /></span><div><h1 id="vault-title">密码保险库</h1><p>集中管理你的登录账号与密码</p></div></div>
      <div class="vault-heading-actions">
        <ATooltip :trigger="['hover', 'focus', 'click']" title="安全审查和加密备份恢复尚未完成，请只使用测试主密码和测试内容。历史版本浏览、到期清理及加密备份仍待后续交付。"><ATag color="gold" class="vault-test-tag" tabindex="0"><Info :size="13" aria-hidden="true" />仅限测试内容</ATag></ATooltip>
        <ATooltip title="重新读取会锁定保险库，编辑中的内容先加密暂存"><AButton :disabled="busy" @click="load"><RefreshCw :size="15" aria-hidden="true" />重新读取保险库</AButton></ATooltip>
      </div>
    </header>
    <AppMessage :notice="feedback" @close="feedback = undefined" />
    <AAlert v-if="problem" :message="problem" type="error" show-icon role="alert" class="vault-inline-alert" />
    <div v-if="phase === 'loading' || phase === 'locking'" class="vault-loading"><ASpin /><p role="status">{{ phase === 'loading' ? '正在读取保险库…' : '正在加密暂存草稿并锁定…' }}</p></div>
    <AAlert v-else-if="phase === 'unavailable'" type="warning" show-icon message="保险库暂时无法读取"><template #action><AButton :disabled="busy" @click="load">重试读取保险库</AButton></template></AAlert>
    <ACard v-else-if="phase === 'new'" class="vault-access-card" :bordered="false" aria-labelledby="create-vault-title">
      <div class="vault-access-heading"><span class="vault-access-icon"><ShieldCheck :size="30" :stroke-width="1.5" aria-hidden="true" /></span><h2 id="create-vault-title">创建保险库</h2><p>设置独立主密码，开启你的加密空间。</p></div>
      <AAlert type="info" show-icon message="主密码与账户登录口令分别管理。忘记主密码后，服务器无法找回。" class="vault-access-notice" />
      <AForm :model="{ password, confirmation, acknowledged }" layout="vertical" @finish="create">
        <AFormItem label="保险库主密码" html-for="vault-master" extra="至少 12 个字符，UTF-8 编码不超过 1024 字节。"><AInput id="vault-master" v-model:value="password" type="password" size="large" autocomplete="new-password" :disabled="busy || !!pending" placeholder="设置独立的主密码" /></AFormItem>
        <AFormItem label="再次输入主密码" html-for="vault-confirmation"><AInput id="vault-confirmation" v-model:value="confirmation" type="password" size="large" autocomplete="new-password" :disabled="busy || !!pending" placeholder="再次输入，确认无误" /></AFormItem>
        <AFormItem><ACheckbox v-model:checked="acknowledged" :disabled="busy || !!pending">我已了解忘记主密码将无法找回，并且当前只使用测试内容。</ACheckbox></AFormItem>
        <AButton html-type="submit" type="primary" size="large" block :loading="busy" :disabled="!pending && (!acknowledged || !password || !confirmation)">{{ pending ? '重试确认创建' : '创建加密保险库' }}</AButton>
      </AForm>
      <p class="vault-access-footnote"><LockKeyhole :size="13" aria-hidden="true" />主密码和解密密钥不会发送到服务器</p>
    </ACard>
    <ACard v-else-if="phase === 'locked'" class="vault-access-card" :bordered="false" aria-labelledby="unlock-vault-title">
      <div class="vault-access-heading"><span class="vault-access-icon"><LockKeyhole :size="30" :stroke-width="1.5" aria-hidden="true" /></span><h2 id="unlock-vault-title">保险库已锁定</h2><p>输入主密码，继续访问登录账号与安全笔记。</p></div>
      <div v-if="pendingChange" class="vault-pending-change" role="status"><AAlert type="info" show-icon message="正在核对主密码修改结果，解密状态已清除。" /><AButton block :loading="busy" @click="retryMasterChange">重试确认主密码修改</AButton></div>
      <AForm v-else :model="{ password }" layout="vertical" @finish="unlock"><AFormItem label="保险库主密码" html-for="vault-unlock"><AInput id="vault-unlock" v-model:value="password" type="password" size="large" autocomplete="off" :disabled="busy" placeholder="输入保险库主密码" /></AFormItem><AButton type="primary" html-type="submit" size="large" block :loading="busy" :disabled="!password"><KeyRound :size="17" aria-hidden="true" />解锁保险库</AButton></AForm>
      <p class="vault-access-footnote"><ShieldCheck :size="14" aria-hidden="true" />闲置 5 分钟、刷新或离开后自动锁定</p>
      <p class="vault-access-secondary">主密码与你的账户登录口令相互独立</p>
    </ACard>
    <section v-else-if="phase === 'unlocked'" class="vault-opened" aria-labelledby="unlocked-vault-title">
      <div class="vault-unlocked-toolbar">
        <div class="vault-status-summary"><h2 id="unlocked-vault-title"><span class="vault-status-dot" />保险库已解锁</h2><span class="vault-status-separator" /><span>无操作 5 分钟后锁定</span><ATooltip :title="`当前服务器版本 ${saved?.version}`"><span class="vault-version">v{{ saved?.version }}</span></ATooltip></div>
        <div class="vault-lock-actions"><ATooltip :title="entryState.editing ? '先保存或关闭当前编辑，再修改主密码' : '修改保险库解锁主密码'"><span><AButton type="text" :disabled="busy || entryState.editing || entryState.working" @click="changeOpen = true"><KeyRound :size="15" aria-hidden="true" />修改主密码</AButton></span></ATooltip><AButton @click="lock()"><LockKeyhole :size="15" aria-hidden="true" />立即锁定</AButton></div>
      </div>
      <VaultEntriesView v-if="saved" ref="entriesView" :worker="worker" :snapshot="saved" :entries="openedEntries" @stored="entriesStored" @notice="notify" @fatal="encryptionFailure" @reload="load" @state="entryState = $event" />
    </section>
    <ChangeMasterPasswordDialog v-if="changeOpen && phase === 'unlocked'" :busy="busy" @close="changeOpen = false" @submit="changeMaster" />
    <ConfirmDialog v-if="leaveConfirmation" message="最新草稿尚未确认加密暂存，继续离开可能丢失最新输入。是否仍要离开？" confirm-label="仍要离开" @answer="leaveConfirmation.answer" />
  </section>
</template>
