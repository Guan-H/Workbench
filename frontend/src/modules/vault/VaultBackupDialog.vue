<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Checkbox as ACheckbox, Form as AForm, FormItem as AFormItem, Input as AInput, RadioButton as ARadioButton, RadioGroup as ARadioGroup } from 'ant-design-vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppDialog from '../../shared/AppDialog.vue'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'
import { api } from '../../shared/api/client'
import { maxBackupBytes, type BackupSummary } from './backup'
import { VaultWorker } from './worker-client'
import { readRestore, storeRestore, type PendingRestore } from './restore-store'
import type { SavedVault } from './types'
import AppPagination from '../../shared/AppPagination.vue'
import type { RestoreSource, ExpiredTrashItem, VaultRetentionPolicy } from './retention'

const props = defineProps<{ username: string; snapshot?: SavedVault; worker?: VaultWorker; source?: RestoreSource }>()
const emit = defineEmits<{ close: []; restored: [action: 'backup' | 'history' | 'cleanup']; notice: [text: string]; fatal: [message: string] }>()
const worker = props.worker ?? new VaultWorker()
const mode = ref<'export' | 'restore'>(props.snapshot && !props.source ? 'export' : 'restore')
const busy = ref(false)
const ready = ref(false)
const error = ref('')
const currentPassword = ref('')
const backupPassword = ref('')
const confirmation = ref('')
const newPassword = ref('')
const newConfirmation = ref('')
const acknowledged = ref(false)
const preview = ref<{ token: string; summary: BackupSummary }>()
const file = ref<File>()
const pending = ref<PendingRestore>()
const abandon = ref(false)
const expired = ref<ExpiredTrashItem[]>([])
const cleanupPage = ref(1)
const action = computed(() => pending.value?.source ?? props.source?.kind ?? 'backup')
const title = computed(() => action.value === 'cleanup' ? '清理过期回收站条目' : action.value === 'history' ? '恢复历史版本' : '加密备份与恢复')
let disposed = false
const allowed = computed(() => !props.snapshot || !!props.worker)
const validPassword = (value: string) => [...value].length >= 12 && new TextEncoder().encode(value).length <= 1024
function forget() { currentPassword.value = ''; backupPassword.value = ''; confirmation.value = ''; newPassword.value = ''; newConfirmation.value = '' }
function failed(cause: unknown) {
  if (!disposed && cause instanceof Error && cause.message.startsWith('VAULT_')) {
    emit('fatal', '加密状态无法确认，保险库已锁定；服务器内容和已暂存的加密请求保留，请重新读取后核对。'); return
  }
  if (!disposed) error.value = cause instanceof SyntaxError ? '文件不是有效的正式加密备份，请核对后重新选择。'
    : cause instanceof Error ? cause.message : '操作未完成，请重试。'
}
async function latest() {
  const value = await api<SavedVault | { initialized: false }>('/vault', { signal: AbortSignal.timeout(30000) })
  if (props.snapshot ? !value.initialized || value.version !== props.snapshot.version || JSON.stringify(value.envelope) !== JSON.stringify(props.snapshot.envelope) : value.initialized) {
    throw new Error('服务器保险库已变化，请关闭弹窗、重新读取并解锁后再操作；本次未覆盖。')
  }
}
async function exportBackup() {
  if (busy.value || !props.snapshot || !props.worker) return
  if (!currentPassword.value || !validPassword(backupPassword.value) || backupPassword.value !== confirmation.value || backupPassword.value === currentPassword.value) {
    error.value = '请输入当前主密码；独立备份口令至少 12 个字符、UTF-8 不超过 1024 字节，须重复一致且不同于主密码。'; return
  }
  busy.value = true; error.value = ''
  try {
    await latest()
    if (disposed) return
    const command = { kind: 'backup-export' as const, envelope: props.snapshot.envelope, currentPassword: currentPassword.value, backupPassword: backupPassword.value }
    const task = worker.request(command)
    command.currentPassword = ''; command.backupPassword = ''; forget()
    const result = await task
    if (disposed) return
    if (result.kind !== 'backup-exported') throw new Error('主密码无法核验或备份加密失败，未生成备份。')
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.backup)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `private-space-vault-${new Date().toISOString().slice(0, 10)}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    emit('notice', '加密备份已生成并发起下载，请确认文件已保存并妥善保管独立备份口令。')
    await close()
  } catch (cause) { failed(cause) }
  finally { if (!disposed) busy.value = false; forget() }
}
function selectFile(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return
  file.value = event.target.files?.[0]; preview.value = undefined; acknowledged.value = false; error.value = ''
}
async function inspect() {
  if (busy.value || !allowed.value || !file.value || !backupPassword.value) return
  busy.value = true; error.value = ''; preview.value = undefined
  try {
    if (!file.value.size || file.value.size > maxBackupBytes) throw new Error('请选择不超过 2 MiB 的正式加密备份文件。')
    await latest()
    const input: unknown = JSON.parse(await file.value.text())
    if (disposed) return
    const command = { kind: 'backup-preview' as const, backup: input, backupPassword: backupPassword.value }
    const task = worker.request(command); command.backupPassword = ''; backupPassword.value = ''
    const result = await task
    if (disposed) return
    if (result.kind !== 'backup-previewed') throw new Error('备份口令不正确、文件损坏或格式不支持；服务器未改动。')
    preview.value = { token: result.token, summary: result.summary }; acknowledged.value = false
  } catch (cause) { failed(cause) }
  finally { if (!disposed) busy.value = false; backupPassword.value = '' }
}
async function submitPending() {
  const request = pending.value
  if (!request) return
  const current = await api<SavedVault | { initialized: false }>('/vault', { signal: AbortSignal.timeout(30000) })
  if (disposed) return
  const expectedVersion = request.mode === 'create' ? '1' : String(BigInt(request.baseVersion) + 1n)
  let saved: SavedVault
  if (current.initialized && current.version === expectedVersion && JSON.stringify(current.envelope) === JSON.stringify(request.envelope)) saved = current
  else {
    if (request.mode === 'create' ? current.initialized : !current.initialized || current.version !== request.baseVersion) {
      throw new Error('服务器版本与原恢复请求不一致，不能继续覆盖。请核对已有保险库；停止重试不会撤销服务器可能完成的恢复。')
    }
    saved = await api<SavedVault>('/vault', { method: request.mode === 'create' ? 'POST' : 'PUT',
      body: JSON.stringify(request.mode === 'create' ? { envelope: request.envelope } : { baseVersion: request.baseVersion, envelope: request.envelope }),
      headers: { 'Idempotency-Key': request.operation }, signal: AbortSignal.timeout(30000) })
  }
  if (disposed) return
  if (!saved.initialized || saved.version !== expectedVersion || JSON.stringify(saved.envelope) !== JSON.stringify(request.envelope)) throw new Error('服务器结果尚未核对，请保留恢复请求并重试。')
  await storeRestore(props.username, request, true)
  if (disposed) return
  const completed = request.source ?? 'backup'
  pending.value = undefined; emit('restored', completed)
}
async function restore() {
  if (busy.value) return
  if (!pending.value && (!preview.value || !acknowledged.value || !allowed.value)) return
  if (!pending.value && !props.snapshot && (!validPassword(newPassword.value) || newPassword.value !== newConfirmation.value)) {
    error.value = '新主密码至少 12 个字符、UTF-8 不超过 1024 字节，两次输入必须一致。'; return
  }
  busy.value = true; error.value = ''
  try {
    if (!pending.value && preview.value) {
      await latest()
      if (disposed) return
      const command = { kind: 'backup-build' as const, token: preview.value.token, ...(props.snapshot ? {} : { newPassword: newPassword.value }) }
      const task = worker.request(command); if ('newPassword' in command) command.newPassword = ''; forget()
      const result = await task
      preview.value = undefined
      if (disposed) return
      if (result.kind !== 'backup-candidate') throw new Error('恢复预览已失效或加密失败，请重新预检。')
      const candidate: PendingRestore = props.snapshot ? { mode: 'replace', baseVersion: props.snapshot.version, operation: crypto.randomUUID(), envelope: result.envelope }
        : { mode: 'create', operation: crypto.randomUUID(), envelope: result.envelope }
      if (props.source && candidate.mode === 'replace') candidate.source = props.source.kind
      await storeRestore(props.username, candidate)
      if (disposed) return
      pending.value = candidate
    }
    await submitPending()
  } catch (cause) { failed(cause) }
  finally { if (!disposed) busy.value = false; forget() }
}
async function stopRetry(accepted: boolean) {
  abandon.value = false
  if (!accepted || !pending.value) return
  busy.value = true
  try { await storeRestore(props.username, pending.value, true); pending.value = undefined; ready.value = true }
  catch (cause) { failed(cause) }
  finally { if (!disposed) busy.value = false }
}
async function reset() {
  preview.value = undefined; file.value = undefined; acknowledged.value = false; forget()
  try { await worker.request({ kind: 'backup-clear' }) } catch (cause) { failed(cause) }
}
async function close() {
  if (busy.value && pending.value) return
  try { await worker.request({ kind: 'backup-clear' }) } catch { /* Parent locking may already have discarded this Worker. */ }
  forget(); emit('close')
}
onMounted(async () => {
  try {
    const request = await readRestore(props.username)
    if (disposed) return
    pending.value = request; ready.value = true
    if (!request && props.source) {
      busy.value = true
      await latest()
      const policy = props.source.kind === 'cleanup' ? await api<VaultRetentionPolicy>('/vault/retention') : undefined
      if (policy && !policy.enabled) throw new Error('保险库清理已在服务器配置中停用，未生成清理请求。')
      if (disposed) return
      const result = await worker.request(props.source.kind === 'history'
        ? { kind: 'history-preview', envelope: props.source.envelope }
        : { kind: 'cleanup-preview', cutoff: policy?.trashCutoff ?? props.source.cutoff })
      if (disposed) return
      if (result.kind !== 'backup-previewed' && result.kind !== 'cleanup-previewed') throw new Error('快照预览未完成，请关闭后重新核对。')
      preview.value = { token: result.token, summary: result.summary }
      if (result.kind === 'cleanup-previewed') expired.value = result.items
    }
  }
  catch (cause) { failed(cause) }
  finally { if (!disposed) busy.value = false }
})
onBeforeUnmount(() => { disposed = true; forget(); preview.value = undefined; expired.value = []; file.value = undefined; if (!props.worker) worker.lock() })
</script>

<template>
  <AppDialog :label="title"><section class="vault-backup-dialog" @keydown.stop>
    <header><h2>{{ title }}</h2><AButton :disabled="busy" @click="close">关闭</AButton></header>
    <div class="vault-backup-body">
      <AAlert v-if="error" :message="error" type="error" show-icon role="alert" />
      <template v-if="pending">
        <AAlert type="warning" show-icon :message="action === 'cleanup' ? '有一份清理请求尚待确认' : '有一份恢复请求尚待确认'" description="仅保存了加密候选，不保存口令。请核对原请求；不要将网络失败理解为服务器没有提交。" />
        <AButton type="primary" :loading="busy" @click="restore">{{ action === 'cleanup' ? '重试确认清理' : '重试确认恢复' }}</AButton>
        <AButton :disabled="busy" @click="abandon = true">停止重试</AButton>
      </template>
      <template v-else-if="ready && allowed">
        <ARadioGroup v-if="!source" v-model:value="mode" :disabled="busy || !!preview" @change="reset"><ARadioButton value="export" :disabled="!snapshot">导出备份</ARadioButton><ARadioButton value="restore">恢复备份</ARadioButton></ARadioGroup>
        <AAlert v-if="!source" type="info" show-icon message="仅备份服务器已保存的当前整库，包含回收站；不包含本机草稿和历史版本。请继续只使用测试内容。" />
        <AAlert v-else-if="source.kind === 'cleanup'" type="warning" show-icon message="清理仅从当前快照移除已过期的回收站条目；仍在保留期内的历史、已有备份和本机草稿不会随之删除。请核对名称与删除时间后确认。" />
        <AAlert v-else type="info" show-icon :message="`将版本 ${source.version} 的内容恢复为新版本，当前主密码不变。历史中已删除的条目仍保留删除状态。`" />
        <AForm v-if="mode === 'export'" :model="{ currentPassword, backupPassword, confirmation }" layout="vertical" @finish="exportBackup">
          <AFormItem label="核验当前主密码" html-for="backup-current"><AInput id="backup-current" v-model:value="currentPassword" type="password" autocomplete="off" :disabled="busy" /></AFormItem>
          <AFormItem label="独立备份口令" html-for="backup-password" extra="至少 12 个字符，与主密码不同；忘记此口令无法解开备份。"><AInput id="backup-password" v-model:value="backupPassword" type="password" autocomplete="new-password" :disabled="busy" /></AFormItem>
          <AFormItem label="确认备份口令" html-for="backup-confirm"><AInput id="backup-confirm" v-model:value="confirmation" type="password" autocomplete="new-password" :disabled="busy" /></AFormItem>
          <AButton type="primary" html-type="submit" :loading="busy">生成加密备份</AButton>
        </AForm>
        <AForm v-else-if="!preview && !source" :model="{ backupPassword }" layout="vertical" @finish="inspect">
          <AFormItem label="加密备份文件" html-for="backup-file"><input id="backup-file" type="file" accept=".json,application/json" :disabled="busy" @change="selectFile" /></AFormItem>
          <AFormItem label="备份口令" html-for="restore-password"><AInput id="restore-password" v-model:value="backupPassword" type="password" autocomplete="off" :disabled="busy" /></AFormItem>
          <AButton type="primary" html-type="submit" :loading="busy" :disabled="!file || !backupPassword">解密并预检</AButton>
        </AForm>
        <div v-else-if="preview">
          <h3>{{ source?.kind === 'cleanup' ? '清理预检' : '恢复预览' }}</h3><p>{{ source?.kind === 'cleanup' ? '清理后保留' : '共' }} {{ preview.summary.total }} 项 · 登录账号 {{ preview.summary.login }} 项 · 安全笔记 {{ preview.summary.secureNote }} 项 · 其中回收站 {{ preview.summary.deleted }} 项</p>
          <template v-if="source?.kind === 'cleanup'"><p><span>待清理 {{ expired.length }} 项</span> · 第 {{ cleanupPage }}/{{ Math.max(1, Math.ceil(expired.length / 10)) }} 页 · 10 项/页</p><ul class="vault-cleanup-items"><li v-for="item in expired.slice((cleanupPage - 1) * 10, cleanupPage * 10)" :key="item.id"><strong>{{ item.name }}</strong><span>删除于 {{ new Date(item.deletedAt).toLocaleString('zh-CN') }}</span></li></ul><AppPagination v-model:page="cleanupPage" :total="expired.length" :pages="Math.max(1, Math.ceil(expired.length / 10))" :page-size="10" :disabled="busy" /></template>
          <AAlert type="warning" show-icon :message="source?.kind === 'cleanup' ? '仅清理上方列出的过期条目，其他内容不变；保存为新版本，当前主密码不变。' : snapshot ? '整库替换，不自动合并；当前主密码不变，旧服务器版本保留。' : '将创建新的保险库，请设置新的主密码。'" />
          <AForm :model="{ newPassword, newConfirmation, acknowledged }" layout="vertical" @finish="restore">
            <template v-if="!snapshot"><AFormItem label="恢复后的新主密码" html-for="restore-master"><AInput id="restore-master" v-model:value="newPassword" type="password" autocomplete="new-password" :disabled="busy" /></AFormItem><AFormItem label="确认新主密码" html-for="restore-confirm"><AInput id="restore-confirm" v-model:value="newConfirmation" type="password" autocomplete="new-password" :disabled="busy" /></AFormItem></template>
            <AFormItem><ACheckbox v-model:checked="acknowledged" :disabled="busy">{{ source?.kind === 'cleanup' ? '我已核对这些过期条目，确认从当前回收站清理，并了解历史、备份和本机草稿不随此操作删除。' : `我已核对恢复范围，确认${snapshot ? '替换当前整库内容' : '创建新保险库'}，并了解本机草稿不会被导入或删除。` }}</ACheckbox></AFormItem>
            <div class="vault-backup-actions"><AButton v-if="!source" :disabled="busy" @click="reset">重新选择</AButton><AButton type="primary" html-type="submit" :loading="busy" :disabled="!acknowledged || source?.kind === 'cleanup' && !expired.length">{{ source?.kind === 'cleanup' ? '确认清理' : '确认恢复' }}</AButton></div>
          </AForm>
        </div>
      </template>
      <AAlert v-else-if="ready" type="info" show-icon message="请先关闭弹窗并解锁已有保险库，再导出或恢复备份。" />
      <p v-else role="status">正在读取本机待确认恢复…</p>
      <p v-if="busy" role="status">正在处理，请稍候；密钥和口令不会发送服务器。</p>
    </div>
    <ConfirmDialog v-if="abandon" message="停止重试只删除本机待确认的加密请求，不会撤销服务器可能已经完成的恢复。请先核对当前保险库。是否停止？" confirm-label="停止重试" @answer="stopRetry" />
  </section></AppDialog>
</template>

<style scoped>
.vault-backup-dialog { padding: 24px; }
.vault-backup-dialog header, .vault-backup-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.vault-backup-dialog h2 { margin: 0; font-size: 19px; }
.vault-backup-body { max-height: min(70vh, 650px); overflow: auto; padding: 20px 2px 2px; display: grid; gap: 16px; }
.vault-backup-body p { line-height: 1.7; }
.vault-backup-body input[type=file] { max-width: 100%; }
.vault-cleanup-items { padding: 0; list-style: none; max-height: 180px; overflow: auto; }
.vault-cleanup-items li { display: grid; gap: 4px; padding: 8px 0; overflow-wrap: anywhere; border-bottom: 1px solid var(--color-border); }
.vault-cleanup-items span { color: var(--color-text-muted); font-size: 12px; }
</style>
