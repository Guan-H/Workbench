<script setup lang="ts">
import { Alert as AAlert, Avatar as AAvatar, Badge as ABadge, Button as AButton, Card as ACard, Empty as AEmpty, Form as AForm, Input as AInput, List as AList, ListItem as AListItem, Menu as AMenu, MenuItem as AMenuItem, Tag as ATag } from 'ant-design-vue'
import { FileKey2, FolderKey, KeyRound, Pencil, Plus, Search, ShieldCheck, Star } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import { api, ApiError } from '../../shared/api/client'
import AppPagination from '../../shared/AppPagination.vue'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'
import VaultEntryFields from './VaultEntryFields.vue'
import { newEntry, parseContent, parseDraft, parseEntry, replaceEntry, type VaultDraft, type VaultEntry } from './entries'
import { listVaultDrafts, putVaultDraft, removeVaultDraft, type VaultDraftRecord } from './draft-store'
import type { SavedVault, PendingVaultSave } from './types'
import type { VaultWorker } from './worker-client'
import type { VaultCommand, VaultReply } from './vault-worker'

const props = defineProps<{ worker: VaultWorker; snapshot: SavedVault; entries: VaultEntry[] }>()
const emit = defineEmits<{ stored: [snapshot: SavedVault, entries: VaultEntry[]]; notice: [text: string]; fatal: [text: string]; reload: []; state: [state: { editing: boolean; working: boolean }] }>()
const editor = ref<VaultEntry>()
const selectedId = ref('')
const selected = computed(() => props.entries.find(entry => entry.id === selectedId.value))
const showingDetails = computed(() => !!selected.value && !editor.value)
const detailTitle = computed(() => editor.value ? original ? '编辑登录条目' : '新增登录条目' : selected.value?.name ?? '条目详情')
const filter = ref<'all' | 'login' | 'favorite'>('all')
const query = ref('')
const page = ref(1)
const matches = computed(() => props.entries.filter(entry => (filter.value !== 'favorite' || entry.favorite)
  && [entry.name, entry.username, ...entry.urls, ...entry.tags, entry.notes].join('\n').toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))
const pages = computed(() => Math.max(1, Math.ceil(matches.value.length / 10)))
const favoriteCount = computed(() => props.entries.filter(entry => entry.favorite).length)
const visibleEntries = computed(() => matches.value.slice((page.value - 1) * 10, page.value * 10))
watch([query, filter], () => { page.value = 1 })
watch(pages, count => { page.value = Math.min(page.value, count) })
const records = ref<VaultDraftRecord[]>([])
const storageReady = ref(false)
const saving = ref(false)
const pumping = ref(false)
const error = ref('')
const draftError = ref('')
const conflicted = ref(false)
const pending = ref<PendingVaultSave>()
const serverEntry = computed(() => editor.value && props.entries.find(entry => entry.id === editor.value!.id))
const confirmation = ref<{ message: string; confirmLabel: string; answer: (accepted: boolean) => void }>()
let disposed = false
let suppress = false
let draftId = ''
let baseVersion = props.snapshot.version
let original: VaultEntry | null = null
let lastRecord: VaultDraftRecord | undefined
let latest: VaultDraft | undefined
let pump: Promise<boolean> = Promise.resolve(true)
let cryptoTail: Promise<unknown> = Promise.resolve()
const recoverableRecords = computed(() => records.value.filter(record => record.id !== draftId))
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(toRaw(value))) as T
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
function task(command: VaultCommand): Promise<VaultReply> {
  const result = cryptoTail.catch(() => {}).then(() => props.worker.request(command))
  cryptoTail = result
  return result
}
watch([editor, saving, pumping], () => { if (!disposed) emit('state', { editing: !!editor.value, working: saving.value || pumping.value }) })
function confirm(message: string, confirmLabel: string): Promise<boolean> {
  return new Promise(resolve => { confirmation.value = { message, confirmLabel, answer: value => { confirmation.value = undefined; resolve(value) } } })
}
function selectFilter(key: string | number) {
  if (key === 'all' || key === 'login' || key === 'favorite') filter.value = key
}
async function readRecords() {
  try { const result = await listVaultDrafts(props.snapshot.vaultId); if (!disposed) { records.value = result; storageReady.value = true } }
  catch { if (!disposed) { storageReady.value = false; error.value = '无法读取本机加密草稿，暂不能编辑。请检查浏览器存储权限后重试。' } }
}
function draft(): VaultDraft | undefined {
  if (!editor.value) return undefined
  return { format: 'private-space-vault-draft-content', version: 1, baseVersion, entry: clone(editor.value), original: original ? clone(original) : null }
}
function scheduleDraft() {
  if (!editor.value || suppress || disposed) return
  latest = draft()
  if (pumping.value) return
  pumping.value = true
  pump = (async () => {
    try {
      // Coalesce rapid edits: keep only the latest not-yet-encrypted revision.
      while (latest) {
        const content = latest
        latest = undefined
        parseDraft(content)
        if (new TextEncoder().encode(JSON.stringify(content)).length > 1048576) throw new Error('DRAFT_TOO_LARGE')
        const result = await task({ kind: 'draft', draft: content })
        if (result.kind !== 'draft') throw new Error('VAULT_DRAFT_FAILED')
        const record: VaultDraftRecord = { id: draftId, vaultId: props.snapshot.vaultId, updatedAt: new Date().toISOString(), envelope: result.envelope,
          ...(pending.value ? { pending: clone(pending.value) } : {}) }
        await putVaultDraft(record)
        lastRecord = record
        draftError.value = ''
      }
      return true
    } catch (cause) {
      latest = undefined
      draftError.value = '本机加密草稿暂存失败，最新输入尚未受到保护。请重试或减少内容后再保存。'
      if (cause instanceof Error && /^VAULT_/.test(cause.message)) emit('fatal', '草稿加密失败，保险库已锁定。最新输入可能未能暂存，上次成功草稿仍保留。')
      return false
    } finally { pumping.value = false }
  })()
}
watch(editor, () => { if (!suppress) scheduleDraft() }, { deep: true, flush: 'sync' })
async function flushDraft(): Promise<boolean> {
  if (editor.value) scheduleDraft()
  return await pump && !draftError.value
}
function hasUnsafeDraft(): boolean { return !!editor.value && (pumping.value || !!latest || !!draftError.value || !lastRecord) }
function closeEditor() {
  suppress = true; editor.value = undefined; suppress = false
  original = null; pending.value = undefined; lastRecord = undefined; draftId = ''; latest = undefined
  conflicted.value = false; draftError.value = ''
}
async function keepEditor(): Promise<boolean> {
  if (!editor.value) return true
  if (saving.value || !await flushDraft()) return false
  closeEditor(); await readRecords(); return true
}
async function begin(entry?: VaultEntry) {
  if (!storageReady.value || saving.value || !await keepEditor() || disposed) return
  error.value = ''; draftId = crypto.randomUUID(); baseVersion = props.snapshot.version; original = entry ? clone(entry) : null
  suppress = true; editor.value = entry ? clone(entry) : newEntry(); suppress = false
  selectedId.value = editor.value.id; scheduleDraft()
  await nextTick(); document.getElementById('vault-entry-name')?.focus()
}
async function select(entry: VaultEntry) { if (await keepEditor() && !disposed) { selectedId.value = entry.id; error.value = '' } }
async function discard() {
  if (!editor.value || saving.value || !await confirm('只放弃本机这份未提交草稿，服务器上的条目不会被删除。待确认请求仍可能已经在服务器完成。', '放弃草稿')) return
  await pump
  try { if (lastRecord) await removeVaultDraft(lastRecord.id, lastRecord.envelope.payload.id); closeEditor(); await readRecords() }
  catch { error.value = '草稿清理失败，原草稿仍保留，请重试。' }
}
async function recover(record: VaultDraftRecord) {
  if (saving.value || !await keepEditor() || disposed) return
  error.value = ''
  try {
    const result = await task({ kind: 'open-draft', envelope: clone(record.envelope) })
    if (disposed) return
    if (result.kind !== 'opened-draft') throw new Error('INVALID_DRAFT')
    const recovered = result.draft
    const current = props.entries.find(item => item.id === recovered.entry.id)
    let retry: PendingVaultSave | undefined
    if (record.pending) {
      const candidate = clone(record.pending)
      if (candidate.baseVersion !== recovered.baseVersion || !/^[0-9a-f-]{36}$/.test(candidate.operation)) throw new Error('INVALID_DRAFT_OPERATION')
      const inspected = await task({ kind: 'inspect', envelope: candidate.envelope })
      if (disposed) return
      if (inspected.kind !== 'inspected' || !equal(inspected.entries.find(item => item.id === recovered.entry.id), recovered.entry)) throw new Error('INVALID_DRAFT_CANDIDATE')
      if (equal(props.snapshot.envelope.payload, candidate.envelope.payload)) {
        selectedId.value = recovered.entry.id
        await removeVaultDraft(record.id, record.envelope.payload.id); await readRecords()
        emit('notice', '服务器已确认保存这份草稿，本机待确认记录已清理。'); return
      }
      if (props.snapshot.version === recovered.baseVersion
          && equal(inspected.entries, replaceEntry(props.entries, recovered.entry))
          && equal(candidate.envelope.kdf, props.snapshot.envelope.kdf)
          && equal(candidate.envelope.wrappedKey, props.snapshot.envelope.wrappedKey)) retry = candidate
    }
    baseVersion = recovered.baseVersion; original = recovered.original; draftId = crypto.randomUUID()
    pending.value = retry
    const unchanged = equal(current ?? null, recovered.original)
    conflicted.value = baseVersion !== props.snapshot.version && !unchanged
    if (baseVersion !== props.snapshot.version && unchanged) { baseVersion = props.snapshot.version; emit('notice', '服务器其他条目已更新，当前条目未改变；草稿将基于最新版本保存。') }
    suppress = true; editor.value = clone(recovered.entry); suppress = false
    selectedId.value = recovered.entry.id
    if (!await flushDraft() || disposed) return
    // Fork before removing the source, so two tabs never share a writable draft identity.
    await removeVaultDraft(record.id, record.envelope.payload.id); await readRecords()
  } catch { if (!disposed) emit('fatal', '无法验证草稿或待确认密文，保险库已锁定；原草稿保留，未提交服务器。') }
}
async function rebase() {
  if (!editor.value || !conflicted.value || !await confirm('请先核对右侧服务器内容。继续后以最新版本为基础编辑此草稿；保存只替换当前条目，并保留其他条目，提交时仍检查版本。', '以当前版本继续编辑')) return
  original = serverEntry.value ? clone(serverEntry.value) : null; baseVersion = props.snapshot.version
  pending.value = undefined; conflicted.value = false; error.value = ''; scheduleDraft()
}
async function save() {
  if (!editor.value || saving.value || conflicted.value) return
  saving.value = true; error.value = ''
  try {
    if (!pending.value) {
      try {
        parseEntry(editor.value)
        editor.value.updatedAt = new Date().toISOString()
        const content = parseContent({ format: 'private-space-vault-content', version: 1, entries: replaceEntry(props.entries, clone(editor.value)) })
        if (new TextEncoder().encode(JSON.stringify(content)).length > 1048576) throw new Error('TOO_LARGE')
      } catch { error.value = '请填写条目名称和自定义字段名称，并检查内容长度；当前加密快照最多 1 MiB。'; return }
      if (!await flushDraft() || disposed) return
      const sealed = await task({ kind: 'seal', content: clone({ format: 'private-space-vault-content', version: 1, entries: replaceEntry(props.entries, clone(editor.value)) }) })
      if (disposed) return
      if (sealed.kind !== 'sealed') throw new Error('VAULT_SEAL_FAILED')
      const candidate: PendingVaultSave = { baseVersion, operation: crypto.randomUUID(), envelope: sealed.envelope }
      if (!lastRecord) throw new Error('DRAFT_MISSING')
      const candidateRecord = { ...lastRecord, pending: candidate }
      // Persist the exact request before HTTP, so reload can confirm an unknown result without making duplicates.
      await putVaultDraft(candidateRecord)
      if (disposed) return
      pending.value = candidate; lastRecord = candidateRecord
    }
    const request = clone(pending.value!)
    const result = await api<SavedVault>('/vault', { method: 'PUT', body: JSON.stringify({ baseVersion: request.baseVersion, envelope: request.envelope }),
      headers: { 'Idempotency-Key': request.operation }, signal: AbortSignal.timeout(30000) })
    if (disposed) return
    if (!result.initialized || result.version !== String(BigInt(request.baseVersion) + 1n) || !equal(result.envelope, request.envelope)) throw new Error('RESULT_NOT_CONFIRMED')
    const adopted = await task({ kind: 'adopt', envelope: result.envelope })
    if (disposed) return
    if (adopted.kind !== 'adopted') throw new Error('VAULT_ADOPT_FAILED')
    emit('stored', result, adopted.entries)
    const completed = lastRecord
    closeEditor()
    emit('notice', '条目已加密保存到服务器。')
    try { if (completed) await removeVaultDraft(completed.id, completed.envelope.payload.id); await readRecords() }
    catch { error.value = '服务器已保存，本机草稿清理未完成，请重新读取后核对。' }
  } catch (cause) {
    if (disposed) return
    if (cause instanceof Error && /^VAULT_/.test(cause.message)) {
      emit('fatal', '加密操作失败，保险库已锁定；本机已成功暂存的加密草稿保留，请重新解锁核对。'); return
    }
    if (cause instanceof ApiError && cause.status === 409) {
      pending.value = undefined; conflicted.value = true
      await flushDraft()
      error.value = '服务器版本已变化，已保留本机加密草稿。请重新读取、解锁后恢复草稿并核对；不会自动覆盖。'
    } else error.value = pending.value ? '保存结果尚未确认，密文请求已保存在本机草稿中。请重试确认保存，或锁定后重新解锁核对。' : '尚未提交保存；请检查加密草稿状态后重试。'
  } finally { if (!disposed) saving.value = false }
}
onMounted(() => { void readRecords() })
onBeforeUnmount(() => {
  disposed = true; confirmation.value?.answer(false)
  suppress = true; editor.value = undefined; suppress = false
  original = null; query.value = ''; records.value = []
  // An already captured final draft may finish sealing during the parent's bounded locking phase.
})
defineExpose({ flushDraft, hasUnsafeDraft, save })
</script>

<template>
  <div class="vault-entries-workspace">
    <AAlert v-if="error" :message="error" type="error" show-icon role="alert" class="vault-inline-alert" />
    <AAlert v-if="draftError" :message="draftError" type="error" show-icon role="alert" class="vault-inline-alert"><template #action><AButton size="small" :disabled="saving" @click="flushDraft">重试暂存草稿</AButton></template></AAlert>
    <div v-if="!storageReady" class="vault-draft-status"><AButton @click="readRecords">重试读取加密草稿</AButton></div>
    <AAlert v-if="recoverableRecords.length" type="info" show-icon class="vault-draft-recovery" :message="`本机有 ${recoverableRecords.length} 份未提交的加密草稿`">
      <template #description><div class="vault-draft-list"><AButton v-for="record in recoverableRecords" :key="record.id" size="small" :disabled="saving || !storageReady" @click="recover(record)">恢复草稿 · {{ new Date(record.updatedAt).toLocaleString('zh-CN') }}{{ record.pending ? ' · 保存待确认' : '' }}</AButton></div></template>
    </AAlert>
    <div class="vault-entry-layout">
      <nav class="vault-categories" aria-label="保险库分类">
        <p class="vault-category-caption">我的保险库</p>
        <AMenu mode="inline" :selected-keys="[filter]" @click="selectFilter($event.key)">
          <AMenuItem key="all"><template #icon><FolderKey :size="17" aria-hidden="true" /></template><span class="vault-menu-label">全部条目<ABadge :count="entries.length" show-zero :overflow-count="9999" /></span></AMenuItem>
          <AMenuItem key="login"><template #icon><KeyRound :size="17" aria-hidden="true" /></template><span class="vault-menu-label">登录账号<ABadge :count="entries.length" show-zero :overflow-count="9999" /></span></AMenuItem>
          <AMenuItem key="favorite"><template #icon><Star :size="17" aria-hidden="true" /></template><span class="vault-menu-label">收藏<ABadge :count="favoriteCount" show-zero :overflow-count="9999" /></span></AMenuItem>
        </AMenu>
        <div class="vault-category-note"><ShieldCheck :size="17" aria-hidden="true" /><span>仅在解锁后查看<br />字段在浏览器内加密</span></div>
      </nav>
      <ACard class="vault-entry-list" :bordered="false" aria-label="保险库条目列表">
        <template #title><span class="vault-panel-title">{{ filter === 'favorite' ? '常用收藏' : '登录账号' }}<ATag>{{ matches.length }}</ATag></span></template>
        <template #extra><AButton type="primary" size="small" :disabled="!storageReady || saving" @click="begin()"><Plus :size="15" aria-hidden="true" />新增登录条目</AButton></template>
        <div class="vault-list-search"><label for="vault-search" class="sr-only">本地搜索</label><AInput id="vault-search" v-model:value="query" placeholder="搜索名称、账号或标签" :maxlength="500" allow-clear><template #prefix><Search :size="16" class="vault-muted" aria-hidden="true" /></template></AInput></div>
        <div class="vault-entry-rows">
          <AList :data-source="visibleEntries" :split="false" :locale="{ emptyText: '暂无条目' }">
            <template #renderItem="{ item }"><AListItem class="vault-list-item"><AButton type="text" class="vault-entry-row" :class="{ active: selectedId === item.id }" :aria-pressed="selectedId === item.id" :disabled="saving" @click="select(item)"><AAvatar shape="square" :size="38" class="vault-entry-avatar">{{ item.name.slice(0, 1) }}</AAvatar><span class="vault-entry-row-copy"><strong>{{ item.name }}</strong><small>{{ item.username || '未填写用户名' }}</small></span><Star v-if="item.favorite" class="vault-favorite-icon" :size="14" aria-label="已收藏" /></AButton></AListItem></template>

          </AList>
        </div>
        <nav class="vault-pagination" aria-label="保险库条目分页"><span>共 {{ matches.length }} 条 · 第 {{ page }}/{{ pages }} 页 · 10 条/页</span><AppPagination v-model:page="page" :pages="pages" :page-size="10" :total="matches.length" /></nav>
      </ACard>
      <ACard class="vault-entry-detail" :bordered="false" aria-label="保险库条目详情">
        <template #title><div class="vault-detail-heading"><AAvatar v-if="showingDetails" shape="square" :size="40" class="vault-entry-avatar">{{ selected?.name.slice(0, 1) }}</AAvatar><span><h2>{{ detailTitle }}</h2><small v-if="showingDetails">登录账号<Star v-if="selected?.favorite" :size="12" aria-label="已收藏" /></small></span></div></template>
        <template #extra><AButton v-if="selected && !editor" :disabled="!storageReady || saving" @click="begin(selected)"><Pencil :size="15" aria-hidden="true" />编辑条目</AButton><ATag v-else-if="editor" :color="draftError ? 'error' : pumping ? 'processing' : 'green'">{{ draftError ? '暂存失败' : pumping ? '加密暂存中' : '本机加密草稿' }}</ATag></template>
        <template v-if="editor">
          <p role="status" class="vault-draft-caption">{{ pumping ? '正在加密暂存本机草稿…' : draftError ? '最新草稿未能暂存' : '草稿已加密暂存在此浏览器，尚未保存服务器' }}</p>
          <AAlert v-if="pending" type="warning" show-icon role="status" message="保存结果尚未确认，输入暂时冻结；重试使用同一密文与操作标识。" class="vault-inline-alert" />
          <div v-if="conflicted" class="vault-conflict"><AAlert type="warning" show-icon role="note" message="核对服务器内容与当前草稿，再继续编辑。" /><AButton :disabled="saving" @click="emit('reload')">重新读取并保留草稿</AButton><details v-if="baseVersion !== snapshot.version"><summary>查看服务器当前条目</summary><VaultEntryFields v-if="serverEntry" :model-value="serverEntry" prefix="vault-server" @notice="emit('notice', $event)" /><p v-else>服务器当前没有此条目。</p></details><AButton v-if="baseVersion !== snapshot.version" :disabled="saving" @click="rebase">核对后以当前版本继续编辑</AButton></div>
          <AForm :model="editor" layout="vertical" class="vault-editor-form" @finish="save">
            <div class="vault-form-scroll"><VaultEntryFields v-model="editor" editing :disabled="saving || !!pending" @notice="emit('notice', $event)" /></div>
            <footer class="vault-edit-actions"><AButton type="text" danger :disabled="saving" @click="discard">放弃草稿</AButton><span class="vault-action-spacer" /><AButton :disabled="saving" @click="keepEditor">关闭编辑并保留草稿</AButton><AButton type="primary" html-type="submit" :loading="saving" :disabled="conflicted">{{ pending ? '重试确认保存' : '保存条目' }}</AButton></footer>
          </AForm>
        </template>
        <div v-else-if="selected" class="vault-detail-scroll"><h2 class="sr-only">登录条目详情</h2><VaultEntryFields :model-value="selected" @notice="emit('notice', $event)" /></div>
        <AEmpty v-else class="vault-entry-empty" description="选择条目查看详情，或新建一个登录账号">
          <template #image><div class="vault-empty-icon"><FileKey2 :size="36" :stroke-width="1.4" aria-hidden="true" /></div></template>
          <AButton type="primary" :disabled="!storageReady || saving" @click="begin()"><Plus :size="16" aria-hidden="true" />新增条目</AButton>
        </AEmpty>
      </ACard>
    </div>
    <ConfirmDialog v-if="confirmation" :message="confirmation.message" :confirm-label="confirmation.confirmLabel" @answer="confirmation.answer" />
  </div>
</template>
