<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Empty as AEmpty, List as AList, ListItem as AListItem, Tag as ATag } from 'ant-design-vue'
import { FilePenLine, RefreshCw, X } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppDialog from '../../shared/AppDialog.vue'
import AppPagination from '../../shared/AppPagination.vue'
import type { VaultDraftRecord } from './draft-store'
import type { VaultDraftSummary } from './entries'

const props = defineProps<{ records: VaultDraftRecord[]; activeId?: string; busy: boolean; storageReady: boolean; error: string; describe: (record: VaultDraftRecord) => Promise<VaultDraftSummary> }>()
const emit = defineEmits<{ close: []; refresh: []; resume: [record: VaultDraftRecord]; discard: [record: VaultDraftRecord] }>()
type Row = { record: VaultDraftRecord; state: 'loading' } | { record: VaultDraftRecord; state: 'ready'; summary: VaultDraftSummary }
const page = ref(1)
const pages = computed(() => Math.max(1, Math.ceil(props.records.length / 10)))
const visible = computed(() => props.records.slice((page.value - 1) * 10, page.value * 10))
const rows = ref<Row[]>([])
const reading = ref(false)
let generation = 0
watch(pages, count => { page.value = Math.min(page.value, count) })
watch(visible, async records => {
  const expected = ++generation
  rows.value = records.map(record => ({ record, state: 'loading' }))
  reading.value = true
  try {
    for (const record of records) {
      const summary = await props.describe(record)
      if (expected !== generation) return
      rows.value = rows.value.map(row => row.record.id === record.id ? { record, state: 'ready', summary } : row)
    }
  } catch { /* The owner locks the vault on failed cryptographic validation; retain the original records. */ }
  finally { if (expected === generation) reading.value = false }
}, { immediate: true })
function actionLabel(summary: VaultDraftSummary) {
  return summary.action === 'new' ? '新增草稿' : summary.action === 'delete' ? '删除待确认' : summary.action === 'restore' ? '恢复待确认' : '编辑草稿'
}
function key(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation() }
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!props.busy) emit('close') }
}
onBeforeUnmount(() => { generation++; rows.value = [] })
</script>

<template>
  <AppDialog label="草稿箱" wide>
    <section class="modal vault-draft-box" @keydown="key">
      <header><h2>草稿箱 <ATag>{{ records.length }}</ATag></h2><div class="vault-draft-box-actions"><AButton size="small" :loading="reading || busy" @click="emit('refresh')"><RefreshCw :size="15" aria-hidden="true" />刷新</AButton><AButton type="text" class="icon-button" aria-label="关闭草稿箱" title="关闭草稿箱" :disabled="busy" @click="emit('close')"><X :size="18" aria-hidden="true" /></AButton></div></header>
      <p class="vault-draft-box-help">仅当前浏览器保存的加密草稿。继续编辑后保存，才会更新服务器。</p>
      <AAlert v-if="!storageReady" message="草稿读取失败，请重试刷新。" type="error" show-icon role="alert" />
      <AAlert v-else-if="error" :message="error" type="error" show-icon role="alert" />
      <div class="vault-draft-box-body">
        <AList v-if="rows.length" :data-source="rows">
          <template #renderItem="{ item }"><AListItem class="vault-draft-box-row" :data-draft-id="item.record.id">
            <FilePenLine :size="20" aria-hidden="true" class="vault-muted" />
            <div class="vault-draft-box-copy"><strong>{{ item.state === 'ready' ? item.summary.name : '正在解密草稿名称…' }}</strong><div v-if="item.state === 'ready'" class="vault-draft-box-tags"><ATag>{{ item.summary.type === 'login' ? '登录账号' : '安全笔记' }}</ATag><ATag>{{ actionLabel(item.summary) }}</ATag><ATag v-if="item.record.pending" color="warning">保存待确认</ATag><ATag v-if="item.record.id === activeId" color="green">正在编辑</ATag></div><time :datetime="item.record.updatedAt">更新于 {{ new Date(item.record.updatedAt).toLocaleString('zh-CN') }}</time></div>
            <div class="vault-draft-box-actions"><AButton type="primary" size="small" :disabled="busy || !storageReady || item.state !== 'ready'" @click="emit('resume', item.record)">{{ item.record.id === activeId ? '返回编辑' : '继续编辑' }}</AButton><AButton danger size="small" :disabled="busy || !storageReady || item.state !== 'ready'" @click="emit('discard', item.record)">放弃草稿</AButton></div>
          </AListItem></template>
        </AList>
        <AEmpty v-else-if="storageReady && !reading" description="草稿箱为空" />
        <p v-else-if="reading" role="status">正在读取草稿…</p>
      </div>
      <footer><span>共 {{ records.length }} 份 · 第 {{ page }}/{{ pages }} 页 · 10 份/页</span><nav aria-label="草稿箱分页"><AppPagination v-model:page="page" :pages="pages" :total="records.length" :page-size="10" :disabled="busy" /></nav></footer>
    </section>
  </AppDialog>
</template>

<style scoped>
.vault-draft-box h2 { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.vault-draft-box-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.vault-draft-box-help { margin: 0; padding: 12px 24px; color: var(--color-text-muted); font-size: 13px; border-bottom: 1px solid var(--color-border); }
.vault-draft-box-body { max-height: 55dvh; overflow-y: auto; padding: 0 24px; }
.vault-draft-box-body > .ant-empty { padding: 24px 0; }
.vault-draft-box-row.ant-list-item { display: flex; gap: 14px; align-items: center; padding: 16px 0; }
.vault-draft-box-copy { min-width: 0; flex: 1; }
.vault-draft-box-copy strong { display: block; overflow-wrap: anywhere; margin-bottom: 8px; }
.vault-draft-box-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.vault-draft-box-tags .ant-tag { margin: 0; }
.vault-draft-box-copy time, .vault-draft-box footer > span { color: var(--color-text-muted); font-size: 12px; }
.vault-draft-box footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; padding: 14px 24px; border-top: 1px solid var(--color-border); }
@media (max-width: 540px) { .vault-draft-box-row.ant-list-item { align-items: flex-start; flex-wrap: wrap; } .vault-draft-box-row > .vault-draft-box-actions { width: 100%; justify-content: flex-end; } .vault-draft-box-body { padding-inline: 16px; max-height: 50dvh; } .vault-draft-box-help { padding-inline: 16px; } }
</style>
