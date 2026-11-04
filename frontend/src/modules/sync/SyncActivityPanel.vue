<script setup lang="ts">
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
    <button :disabled="loading" @click="load(true)">刷新同步记录</button>
    <p v-if="loading" role="status">正在读取同步记录…</p>
    <p v-else-if="error" role="alert">{{ error }} <button @click="load()">重试</button></p>
    <p v-else-if="data && !data.items.length">暂无成功上报的同步记录。</p>
    <div v-else-if="data" class="sync-device-scroll" tabindex="0" aria-label="同步记录列表">
      <table class="sync-device-table"><thead><tr><th scope="col">接收时间</th><th scope="col">助手状态</th><th scope="col">待上传/改名</th><th scope="col">范围外暂存</th><th scope="col">冲突 / 问题</th><th scope="col">错误 / 范围</th></tr></thead><tbody>
        <tr v-for="item in data.items" :key="item.revision" data-sync-activity><td>{{ new Date(item.reportedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }}</td><td>{{ helperPhases[item.status.phase] }}</td><td>{{ item.status.queued }}</td><td>{{ item.status.heldQueued }}</td><td>{{ item.status.conflicts }} / {{ item.status.issues }}</td><td>{{ item.status.code ?? '无已上报错误' }}<span v-if="item.scopeVersion !== data.scopeVersion"> · 旧范围记录</span></td></tr>
      </tbody></table>
    </div>
    <footer class="sync-pagination"><button :disabled="loading || cursors.length === 1" @click="turn(false)">上一页</button><span>第 {{ cursors.length }} 页 · 每页 20 条</span><button :disabled="loading || !!error || !data?.nextCursor" @click="turn(true)">下一页</button></footer>
  </div>
</template>
