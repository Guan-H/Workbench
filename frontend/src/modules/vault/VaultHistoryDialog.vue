<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Empty as AEmpty, List as AList, ListItem as AListItem, Tag as ATag, Input as AInput } from 'ant-design-vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppDialog from '../../shared/AppDialog.vue'
import AppPagination from '../../shared/AppPagination.vue'
import { api } from '../../shared/api/client'
import type { SavedVault } from './types'
import type { HistoryPage, HistoryItem, VaultRetentionPolicy } from './retention'
import type { VaultEntry } from './entries'
import { VaultWorker } from './worker-client'
import VaultEntryFields from './VaultEntryFields.vue'
import VaultEntryAvatar from './VaultEntryAvatar.vue'

const props = defineProps<{ snapshot: SavedVault; worker: VaultWorker; policy?: VaultRetentionPolicy }>()
const emit = defineEmits<{ close: []; restore: [version: SavedVault]; fatal: [message: string]; notice: [message: string] }>()
const listing = ref<HistoryPage>()
const page = ref(1)
const busy = ref(false)
const error = ref('')
const selectedVersion = ref<SavedVault>()
const entries = ref<VaultEntry[]>([])
const selectedId = ref('')
const query = ref('')
const itemPage = ref(1)
const filtered = computed(() => entries.value.filter(item => item.name.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))
const visibleEntries = computed(() => filtered.value.slice((itemPage.value - 1) * 10, itemPage.value * 10))
const selected = computed(() => entries.value.find(item => item.id === selectedId.value))
let disposed = false
function kind(item: HistoryItem) { return item.operationKind === 'master-password' ? '主密码修改' : item.operationKind === 'content' ? '内容快照' : '创建快照' }
async function list(next = 1, reset = false) {
  busy.value = true; error.value = ''
  try {
    const result = await api<HistoryPage>(`/vault/history?page=${next}${!reset && listing.value ? '&anchor=' + listing.value.anchor : ''}`, { signal: AbortSignal.timeout(30000) })
    if (!disposed) {
      listing.value = result
      const last = Math.max(1, Math.ceil(result.total / 10))
      if (next > last) { await list(last); return }
      page.value = next
    }
  } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : '历史读取失败。' }
  finally { if (!disposed) busy.value = false }
}
async function inspect(item: HistoryItem) {
  if (busy.value) return
  busy.value = true; error.value = ''; entries.value = []; selectedVersion.value = undefined; selectedId.value = ''; query.value = ''; itemPage.value = 1
  try {
    const snapshot = await api<SavedVault>(`/vault/history/${item.version}`, { signal: AbortSignal.timeout(30000) })
    if (disposed) return
    const result = await props.worker.request({ kind: 'inspect', envelope: snapshot.envelope })
    if (disposed) return
    if (result.kind !== 'inspected') throw new Error('VAULT_HISTORY_REJECTED')
    entries.value = result.entries; selectedVersion.value = snapshot
  } catch (cause) {
    if (disposed) return
    if (cause instanceof Error && cause.message.startsWith('VAULT_')) emit('fatal', '历史密文无法认证或密钥不匹配，保险库已锁定；当前内容未改动。')
    else error.value = cause instanceof Error ? cause.message : '历史读取失败。'
  } finally { if (!disposed) busy.value = false }
}
onMounted(() => { void list() })
onBeforeUnmount(() => { disposed = true; entries.value = []; selectedVersion.value = undefined; selectedId.value = ''; query.value = '' })
</script>

<template>
  <AppDialog label="保险库历史版本" wide><section class="vault-history-dialog" @keydown.stop>
    <header><h2>保险库历史版本</h2><div><AButton :disabled="busy" @click="list(1, true)">刷新历史</AButton><AButton :disabled="busy" @click="emit('close')">关闭历史</AButton></div></header>
    <p class="vault-muted">历史内容只在解锁后的本机读取。恢复会整库替换为一个新版本，当前主密码不变，原版本不被改写。</p>
    <p v-if="policy" class="vault-muted">{{ policy.enabled ? `历史按 ${policy.historyDays} 天保留，当前版本始终保留；已到期清理的版本不能再查看。` : '服务器已停用保险库自动保留清理。' }}</p>
    <AAlert v-if="error" :message="error" type="error" show-icon role="alert" />
    <div class="vault-history-layout">
      <div class="vault-history-versions"><div class="vault-history-scroll"><AList :data-source="listing?.items ?? []" :loading="busy"><template #renderItem="{ item }"><AListItem><AButton type="text" :disabled="busy" :class="{ chosen: selectedVersion?.version === item.version }" @click="inspect(item)"><strong>版本 {{ item.version }}</strong><span>{{ kind(item) }} <ATag v-if="item.version === listing?.currentVersion">当前</ATag></span><time>{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</time></AButton></AListItem></template></AList></div><nav aria-label="保险库历史分页"><p>共 {{ listing?.total ?? 0 }} 条 · 第 {{ page }}/{{ Math.max(1, Math.ceil((listing?.total ?? 0) / 10)) }} 页 · 10 条/页</p><AppPagination :page="page" :total="listing?.total ?? 0" :pages="Math.max(1, Math.ceil((listing?.total ?? 0) / 10))" :page-size="10" :disabled="busy" @update:page="list($event)" /></nav></div>
      <section class="vault-history-preview">
        <template v-if="selectedVersion"><h3>版本 {{ selectedVersion.version }} · 只读内容</h3><p>共 {{ entries.length }} 项，含回收站 {{ entries.filter(item => item.deletedAt).length }} 项</p><AButton type="primary" :disabled="busy || selectedVersion.version === snapshot.version" @click="emit('restore', selectedVersion)">恢复此版本</AButton>
          <label for="history-search">筛选条目名称</label><AInput id="history-search" v-model:value="query" @input="itemPage = 1" />
          <div class="vault-history-entry-list"><AButton v-for="entry in visibleEntries" :key="entry.id" :class="{ chosen: selectedId === entry.id }" @click="selectedId = entry.id">{{ entry.name }} <ATag v-if="entry.deletedAt">已删除</ATag></AButton></div>
          <nav aria-label="历史条目分页"><p>共 {{ filtered.length }} 项 · 第 {{ itemPage }}/{{ Math.max(1, Math.ceil(filtered.length / 10)) }} 页 · 10 项/页</p><AppPagination v-model:page="itemPage" :total="filtered.length" :pages="Math.max(1, Math.ceil(filtered.length / 10))" :page-size="10" /></nav>
          <div v-if="selected" class="vault-history-entry-heading"><VaultEntryAvatar :name="selected.name" :icon="selected.icon" :size="32" /><strong>{{ selected.name }}</strong><ATag>{{ selected.type === 'login' ? '登录账号' : '安全笔记' }}</ATag></div>
          <VaultEntryFields v-if="selected" :key="`${selectedVersion.version}:${selected.id}`" :model-value="selected" prefix="history-entry" @notice="emit('notice', $event)" /><AEmpty v-else :description="entries.length ? '选择条目查看只读详情' : '该版本为空保险库'" />
        </template><AEmpty v-else description="选择版本，解密后查看内容" />
      </section>
    </div>
  </section></AppDialog>
</template>

<style scoped>
.vault-history-dialog { padding: 22px; }
header, header > div { display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
h2 { margin: 0; font-size: 20px; }
.vault-history-layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 20px; }
.vault-history-versions { display: flex; flex-direction: column; min-height: 0; }
.vault-history-scroll, .vault-history-preview { max-height: 62vh; overflow: auto; }
.vault-history-versions button { height: auto; display: grid; gap: 4px; text-align: left; width: 100%; padding: 10px; }
.chosen { background: #e7f0e9; }
.vault-history-preview { display: grid; gap: 14px; align-content: start; min-width: 0; }
.vault-history-preview > label, .vault-history-preview > input { display: block; }
.vault-history-entry-list { display: flex; flex-direction: column; gap: 8px; }
.vault-history-entry-list button { white-space: normal; height: auto; overflow-wrap: anywhere; }
.vault-history-entry-heading { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; overflow-wrap: anywhere; }
@media (max-width: 600px) { .vault-history-layout { grid-template-columns: minmax(0, 1fr); } .vault-history-layout { max-height: 65vh; overflow: auto; } .vault-history-scroll { max-height: 190px; } .vault-history-preview { max-height: none; } }
</style>
