<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Checkbox as ACheckbox, Form as AForm, FormItem as AFormItem, Input as AInput, Tag as ATag } from 'ant-design-vue'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppDialog from '../../shared/AppDialog.vue'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'
import { api } from '../../shared/api/client'
import { VaultWorker } from './worker-client'
import type { SavedVault } from './types'
import { parseRecoveryStatus, type RecoveryStatus } from './recovery-format'
import { readRecoveryRequest, storeRecoveryRequest, type PendingRecovery } from './recovery-store'
import { readVaultRequest } from './restore-store'

const props = defineProps<{ username: string; mode: 'setup' | 'reset' | 'pending'; snapshot: SavedVault; worker?: VaultWorker }>()
const emit = defineEmits<{ close: []; completed: [message: string]; fatal: [message: string]; notice: [message: string] }>()
const worker = props.worker ?? new VaultWorker()
const busy = ref(false), ready = ref(false), error = ref(''), password = ref(''), secret = ref(''), repeated = ref('')
const newPassword = ref(''), confirmation = ref(''), acknowledged = ref(false), savedOffline = ref(false)
const staged = ref<{ token: string }>(), status = ref<RecoveryStatus>(), pending = ref<PendingRecovery>(), abandon = ref(false)
const loading = ref(true), panel = ref<HTMLElement>()
let disposed = false
function forget() { password.value = ''; secret.value = ''; repeated.value = ''; newPassword.value = ''; confirmation.value = '' }
function failure(cause: unknown) {
  if (disposed) return
  error.value = cause instanceof Error ? cause.message : '操作未完成，请重试。'
  if (cause instanceof Error && cause.message.startsWith('VAULT_')) emit('fatal', '加密状态已失效，保险库已锁定，原数据和已暂存请求保留。')
}
async function current() {
  const value = await api<SavedVault>('/vault', { signal: AbortSignal.timeout(30000) })
  if (!value.initialized || value.version !== props.snapshot.version || JSON.stringify(value.envelope) !== JSON.stringify(props.snapshot.envelope)) {
    throw new Error('保险库版本已变化，请关闭并重新读取，再核对操作；本次未覆盖。')
  }
  return value
}
async function generate() {
  if (busy.value || !password.value || !props.worker) return
  busy.value = true; error.value = ''; staged.value = undefined; secret.value = ''; savedOffline.value = false; acknowledged.value = false
  try {
    await current()
    if (disposed) return
    const command = { kind: 'recovery-generate' as const, currentPassword: password.value }
    const task = worker.request(command); command.currentPassword = ''; password.value = ''
    const reply = await task
    if (disposed) return
    if (reply.kind !== 'recovery-generated') throw new Error('当前主密码核验失败或生成失败，恢复设置未改变。')
    staged.value = { token: reply.token }; secret.value = reply.secret
  } catch (cause) { failure(cause) }
  finally { if (!disposed) busy.value = false; password.value = '' }
}
function download() {
  if (!secret.value) return
  const file = new Blob([`私有空间保险库恢复密钥\n保险库标识：${props.snapshot.vaultId}\n${secret.value}\n\n保存在可信离线位置。该密钥可用于重置主密码并解密保险库，不要发送给他人。\n`], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(file), link = document.createElement('a')
  link.href = url; link.download = 'private-space-vault-recovery-key.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function submitPending() {
  const request = pending.value
  if (!request) return
  const now = await api<SavedVault>('/vault', { signal: AbortSignal.timeout(30000) })
  const policy = parseRecoveryStatus(await api<unknown>('/vault/recovery'))
  if (disposed) return
  const expected = String(BigInt(request.baseVersion) + 1n)
  const matches = now.initialized && now.version === expected && JSON.stringify(now.envelope) === JSON.stringify(request.envelope)
    && policy.version === expected && policy.enabled && (request.mode === 'configure-recovery'
      ? JSON.stringify(policy.recovery) === JSON.stringify(request.recovery) : policy.recovery.id === request.recoveryId)
  if (!matches) {
    if (!now.initialized || now.version !== request.baseVersion || (request.mode === 'reset-master' && (!policy.enabled || policy.recovery.id !== request.recoveryId))) {
      throw new Error('服务器版本或恢复密钥已变化，不能继续旧请求。请先核对，停止重试不会撤销可能已完成的操作。')
    }
    const result = await api<SavedVault>(request.mode === 'configure-recovery' ? '/vault/recovery' : '/vault/recovery/reset-master-password', {
      method: 'PUT', body: JSON.stringify(request.mode === 'configure-recovery'
        ? { baseVersion: request.baseVersion, envelope: request.envelope, recovery: request.recovery }
        : { baseVersion: request.baseVersion, envelope: request.envelope, recoveryId: request.recoveryId }),
      headers: { 'Idempotency-Key': request.operation }, signal: AbortSignal.timeout(30000),
    })
    if (!result.initialized || result.version !== expected || JSON.stringify(result.envelope) !== JSON.stringify(request.envelope)) throw new Error('服务器结果未能核对，请保留待确认请求。')
  }
  if (disposed) return
  await storeRecoveryRequest(props.username, request, true)
  if (disposed) return
  pending.value = undefined; forget(); worker.lock()
  emit('completed', request.mode === 'configure-recovery' ? '恢复密钥已启用，请用主密码重新解锁。请保管刚才保存的密钥。' : '主密码已重置，内容已保留，请使用新主密码解锁。')
}
async function submit() {
  if (busy.value || !ready.value) return
  if (!pending.value && !acknowledged.value) { error.value = '请先确认操作说明。'; return }
  busy.value = true; error.value = ''
  try {
    if (!pending.value) {
      await current()
      if (disposed) return
      let candidate: PendingRecovery
      if (props.mode === 'setup') {
        if (!staged.value || !savedOffline.value || !repeated.value) throw new Error('请先离线保存密钥，再重新输入核对。')
        const command = { kind: 'recovery-confirm' as const, token: staged.value.token, secret: repeated.value }
        const task = worker.request(command); command.secret = ''; repeated.value = ''; secret.value = ''
        const reply = await task; staged.value = undefined
        if (reply.kind !== 'recovery-configured') throw new Error('密钥核对失败，请重新生成、保存并核对，原恢复设置未改动。')
        candidate = { mode: 'configure-recovery', baseVersion: props.snapshot.version, envelope: props.snapshot.envelope,
          recovery: reply.recovery, operation: crypto.randomUUID() }
      } else {
        if (!status.value?.enabled) throw new Error('该保险库尚未启用恢复密钥，无法用此方式重置。')
        if ([...newPassword.value].length < 12 || new TextEncoder().encode(newPassword.value).length > 1024 || newPassword.value !== confirmation.value) {
          throw new Error('新主密码至少 12 个字符、UTF-8 不超过 1024 字节，两次输入须一致。')
        }
        const command = { kind: 'recovery-reset' as const, envelope: props.snapshot.envelope, recovery: status.value.recovery, secret: secret.value, newPassword: newPassword.value }
        const task = worker.request(command); command.secret = ''; command.newPassword = ''; forget()
        const reply = await task
        if (reply.kind !== 'recovery-reset') throw new Error('恢复密钥不正确、密文异常或重置失败，服务器原数据未改动。')
        candidate = { mode: 'reset-master', baseVersion: props.snapshot.version, recoveryId: status.value.recovery.id,
          envelope: reply.envelope, operation: crypto.randomUUID() }
      }
      if (disposed) return
      await storeRecoveryRequest(props.username, candidate)
      pending.value = candidate
    }
    await submitPending()
  } catch (cause) { failure(cause) }
  finally { forget(); if (!disposed) busy.value = false }
}
async function stopRetry(accepted: boolean) {
  abandon.value = false
  if (!accepted || !pending.value) return
  busy.value = true
  try { await storeRecoveryRequest(props.username, pending.value, true); pending.value = undefined; emit('close') }
  catch (cause) { failure(cause) }
  finally { if (!disposed) busy.value = false }
}
function hideSecret() { if (!savedOffline.value) return; secret.value = '' }
async function regenerate() {
  if (busy.value) return
  forget(); staged.value = undefined; savedOffline.value = false; acknowledged.value = false
  try { await worker.request({ kind: 'recovery-clear' }); await nextTick(); panel.value?.querySelector<HTMLInputElement>('input')?.focus() }
  catch (cause) { failure(cause) }
}
onMounted(async () => {
  try {
    pending.value = await readRecoveryRequest(props.username)
    if (disposed) return
    if (!pending.value && await readVaultRequest(props.username)) throw new Error('已有其他待确认请求，请先处理，当前不会覆盖。')
    if (!pending.value) {
      await current()
      status.value = parseRecoveryStatus(await api<unknown>('/vault/recovery'))
      if (status.value.version !== props.snapshot.version) throw new Error('恢复设置已变化，请重新读取。')
    }
    if (!disposed) { ready.value = true; await nextTick(); panel.value?.querySelector<HTMLInputElement>('input:not([disabled])')?.focus() }
  } catch (cause) { failure(cause) }
  finally { if (!disposed) loading.value = false }
})
onBeforeUnmount(() => { disposed = true; forget(); staged.value = undefined; if (!props.worker) worker.lock(); else if (!busy.value) void worker.request({ kind: 'recovery-clear' }).catch(() => undefined) })
</script>

<template>
  <AppDialog :label="mode === 'setup' ? '设置恢复密钥' : '重置保险库主密码'">
    <section ref="panel" class="vault-recovery-dialog" @keydown.stop @keydown.ctrl.s.prevent @keydown.meta.s.prevent>
      <header><h2>{{ mode === 'setup' ? '设置恢复密钥' : '重置保险库主密码' }}</h2><AButton :disabled="busy" @click="emit('close')">关闭</AButton></header>
      <AAlert v-if="error" type="error" show-icon :message="error" role="alert" />
      <p v-if="loading" role="status">正在读取恢复设置…</p>
      <template v-if="pending">
        <AAlert type="warning" show-icon message="有一份恢复密钥操作尚待确认" description="加密请求已暂存在本浏览器。重试只核对原操作；停止重试不会撤销服务器可能已完成的设置或重置。" />
        <footer><AButton :disabled="busy" @click="abandon = true">停止重试</AButton><AButton type="primary" :loading="busy" @click="submit">重试确认恢复操作</AButton></footer>
      </template>
      <AForm v-else-if="ready && mode === 'setup'" :model="{ password, repeated, savedOffline, acknowledged }" layout="vertical" @finish="submit">
        <AAlert type="warning" show-icon :message="status?.enabled ? '已启用恢复密钥，重新生成会替换当前恢复密钥' : '尚未启用恢复密钥'" description="持有密钥并取得保险库密文即可解密内容，请保存在可信离线位置。更换只影响当前在线恢复入口，旧备份中的恢复信息无法远程撤销。" />
        <template v-if="!staged">
          <AFormItem label="当前保险库主密码" html-for="recovery-current"><AInput id="recovery-current" v-model:value="password" type="password" autocomplete="off" :disabled="busy" /></AFormItem>
          <AButton :loading="busy" :disabled="!password" @click="generate">生成恢复密钥</AButton>
        </template>
        <template v-else>
          <AFormItem label="恢复密钥" extra="先下载并妥善保存，再进入重新输入核对。关闭或锁定后不再显示，服务器不能找回。"><AInput.TextArea :value="secret || '已隐藏，请从离线保存的位置重新输入核对'" readonly :rows="3" /></AFormItem>
          <AButton :disabled="busy || !secret" @click="download">下载恢复密钥</AButton>
          <AButton type="link" :disabled="busy" @click="regenerate">重新生成</AButton>
          <p><ACheckbox v-model:checked="savedOffline" :disabled="busy" @change="hideSecret">我已将恢复密钥保存在可信离线位置</ACheckbox></p>
          <AFormItem label="重新输入恢复密钥" html-for="recovery-repeat"><AInput id="recovery-repeat" v-model:value="repeated" type="password" autocomplete="off" :disabled="busy || !savedOffline" /></AFormItem>
          <ACheckbox v-model:checked="acknowledged" :disabled="busy">确认启用此密钥；如已有恢复密钥，将替换当前恢复入口。</ACheckbox>
          <footer><AButton type="primary" html-type="submit" :loading="busy" :disabled="!savedOffline || !acknowledged || !repeated">确认启用恢复密钥</AButton></footer>
        </template>
      </AForm>
      <AForm v-else-if="ready && status?.enabled && mode === 'reset'" :model="{ secret, newPassword, confirmation, acknowledged }" layout="vertical" @finish="submit">
        <AAlert type="info" show-icon message="无需旧主密码，凭提前保存的恢复密钥重置" description="仅更换主密码包装，条目、历史及同密钥草稿保留。账户登录密码保持不变，恢复密钥仍可继续使用。" />
        <AFormItem label="恢复密钥" html-for="recovery-secret"><AInput id="recovery-secret" v-model:value="secret" type="password" autocomplete="off" :disabled="busy" /></AFormItem>
        <AFormItem label="新保险库主密码" html-for="recovery-new" extra="至少 12 个字符，UTF-8 不超过 1024 字节。"><AInput id="recovery-new" v-model:value="newPassword" type="password" autocomplete="new-password" :disabled="busy" /></AFormItem>
        <AFormItem label="再次输入新保险库主密码" html-for="recovery-confirm"><AInput id="recovery-confirm" v-model:value="confirmation" type="password" autocomplete="new-password" :disabled="busy" /></AFormItem>
        <ACheckbox v-model:checked="acknowledged" :disabled="busy">我已保管新主密码，确认重置并保留原有内容。</ACheckbox>
        <footer><ATag>账户已登录</ATag><AButton type="primary" html-type="submit" :loading="busy" :disabled="!acknowledged || !secret || !newPassword || !confirmation">确认重置主密码</AButton></footer>
      </AForm>
      <AAlert v-else-if="ready && !pending" type="warning" show-icon message="没有可用的恢复设置" description="必须在知道主密码时先启用恢复密钥。忘记后不能补生成；如有独立口令的加密备份，可另行恢复备份。" />
    </section>
    <ConfirmDialog v-if="abandon" message="停止重试不会撤销已提交的操作。请先确认已保管恢复密钥或新主密码，之后重新读取并核对。确定停止重试？" confirm-label="停止重试" @answer="stopRetry" />
  </AppDialog>
</template>

<style scoped>
.vault-recovery-dialog { display: flex; flex-direction: column; gap: 16px; padding: 20px; box-sizing: border-box; max-height: min(82dvh, 760px); overflow-y: auto; overflow-x: hidden; }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { font-size: 20px; margin: 0; } footer { margin-top: 18px; flex-wrap: wrap; justify-content: flex-end; }
.ant-alert { margin-bottom: 16px; } .ant-input { min-width: 0; } p { margin: 16px 0; }
</style>
