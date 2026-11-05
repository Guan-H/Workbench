<script setup lang="ts">
import { Table as ATable, Button as AButton } from 'ant-design-vue'

import { onBeforeUnmount, ref, watch } from 'vue'
import { api } from '../../shared/api/client'
import { helperPhases, type HelperStatus } from './status'
const props = defineProps<{ device: string }>()
interface Activity { revision: string; scopeVersion: string; reportedAt: string; status: HelperStatus }
interface Page { scopeVersion: string; items: Activity[]; nextCursor: string | null }
const data = ref<Page>()
const error = ref('')
const loading = ref(false)
const cursors = ref([''])
let request: AbortController | undefined
async function load(reset = false) {
  request?.abort(); const current = request = new AbortController()
  if (reset) cursors.value = ['']
  loading.value = true; error.value = ''
  try {
    const page = await api<Page>(`/sync-devices/${encodeURIComponent(props.device)}/activity?limit=20&cursor=${encodeURIComponent(cursors.value.at(-1) ?? '')}`, { signal: current.signal })
    if (!current.signal.aborted) data.value = page
  } catch (cause) { if (!current.signal.aborted) error.value = cause instanceof Error ? cause.message : '同步记录读取失败。' }
  finally { if (!current.signal.aborted) loading.value = false }
}
function turn(next: boolean) {
  if (next && data.value?.nextCursor) cursors.value.push(data.value.nextCursor)
  else if (!next && cursors.value.length > 1) cursors.value.pop()
  else return
  void load()
}
watch(() => props.device, () => { data.value = undefined; void load(true) }, { immediate: true })
onBeforeUnmount(() => request?.abort())
</script>

<template>
  <div aria-label="设备同步记录">
    <p>以下记录来自助手成功上报的观察；断网期间尚未上报的操作可能缺失，记录时间是服务器接收时间。</p>
    <AButton :disabled="loading" @click="load(true)">刷新同步记录</AButton>
    <p v-if="loading" role="status">正在读取同步记录…</p>
    <p v-else-if="error" role="alert">{{ error }} <AButton @click="load()">重试</AButton></p>
    <p v-else-if="data && !data.items.length">暂无成功上报的同步记录。</p>
    <div v-else-if="data" class="sync-device-scroll" tabindex="0" aria-label="同步记录列表">
      <ATable :columns='[{"key":"0","title":"接收时间"},{"key":"1","title":"助手状态"},{"key":"2","title":"待上传/改名"},{"key":"3","title":"范围外暂存"},{"key":"4","title":"冲突 / 问题"},{"key":"5","title":"错误 / 范围"}]' :data-source="data.items" :row-key="item => item.revision" :pagination="false" size="small" :scroll="{ x: 980 }" :custom-row="() => ({ class: 'sync-record-row', 'data-sync-activity': '' })">
        <template #bodyCell="{ column, record }">
          <template v-for="item in (data?.items ?? []).filter(row => row.revision === record.revision)" :key="item.revision">
          <template v-if="column.key === '0'">{{ new Date(item.reportedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }}</template>
          <template v-else-if="column.key === '1'">{{ helperPhases[item.status.phase] }}</template>
          <template v-else-if="column.key === '2'">{{ item.status.queued }}</template>
          <template v-else-if="column.key === '3'">{{ item.status.heldQueued }}</template>
          <template v-else-if="column.key === '4'">{{ item.status.conflicts }} / {{ item.status.issues }}</template>
          <template v-else-if="column.key === '5'">{{ item.status.code ?? '无已上报错误' }}<span v-if="item.scopeVersion !== data.scopeVersion"> · 旧范围记录</span></template>
          </template>
        </template>
      </ATable>
    </div>
    <footer class="sync-pagination"><AButton :disabled="loading || cursors.length === 1" @click="turn(false)">上一页</AButton><span>第 {{ cursors.length }} 页 · 每页 20 条</span><AButton :disabled="loading || !!error || !data?.nextCursor" @click="turn(true)">下一页</AButton></footer>
  </div>
</template>
