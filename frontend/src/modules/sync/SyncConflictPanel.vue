<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { api } from '../../shared/api/client'
const props = defineProps<{ device: string; name: string; scopeVersion: string; revoked: boolean }>()
interface Item { path: string; reason: string; localState: string; localSha256: string | null; baselineVersion: string | null; copies: number; reportedAt: string; scopeVersion: string; inScope: boolean }
interface Page { reported: boolean; revoked: boolean; reportedAt: string | null; scopeVersion: string; items: Item[]; nextCursor: string | null }
const data = ref<Page>()
const loading = ref(false)
const error = ref('')
const feedback = ref('')
const cursors = ref([''])
let request: AbortController | undefined
const reasons: Record<string, string> = {
  BOTH_MODIFIED: '两端均修改', INITIAL_COLLISION: '初次合并内容不同', INITIAL_TOMBSTONE: '本地内容与删除记录冲突',
  DELETE_MODIFY: '删除与修改冲突', RECONCILIATION_UNKNOWN_DELETE: '旧路径缺失，无法确认删除',
  RECONCILIATION_ARCHIVED_EDIT: '对账归档中有待处理编辑', RECONCILIATION_ARCHIVED_RENAME: '对账归档中有待处理改名',
}
function time(value: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚未上报' }
async function load(reset = false) {
  request?.abort(); const current = request = new AbortController()
  if (reset) cursors.value = ['']
  loading.value = true; error.value = ''; feedback.value = ''
  try {
    const result = await api<Page>(`/sync-devices/${encodeURIComponent(props.device)}/conflicts?limit=20&cursor=${encodeURIComponent(cursors.value.at(-1) ?? '')}`, { signal: current.signal })
    if (!current.signal.aborted) data.value = result
  } catch (cause) { if (!current.signal.aborted) error.value = cause instanceof Error ? cause.message : '冲突记录读取失败，请重试。' }
  finally { if (!current.signal.aborted) loading.value = false }
}
function next() { if (data.value?.nextCursor) { cursors.value.push(data.value.nextCursor); void load() } }
function previous() { if (cursors.value.length > 1) { cursors.value.pop(); void load() } }
async function copy(path: string) {
  try { await navigator.clipboard.writeText(path); feedback.value = '库内路径已复制，请在同步助手中选中该路径并处理冲突。' }
  catch { feedback.value = '无法复制，请在列表中手动选择并复制路径。' }
}
watch(() => [props.device, props.scopeVersion, props.revoked], () => { data.value = undefined; void load(true) }, { immediate: true })
onBeforeUnmount(() => request?.abort())
</script>

<template>
  <section class="home-card sync-conflicts" aria-labelledby="conflict-title">
    <header class="home-card-heading"><h2 id="conflict-title">冲突记录 · {{ name }}</h2><button :disabled="loading" @click="load(true)">刷新冲突记录</button></header>
    <p class="sync-contact-note">以下是助手最后成功上报的观察，不代表实时状态。最近接收上报：{{ time(data?.reportedAt ?? null) }}。</p>
    <p class="sync-contact-note">在同步助手中选中对应路径，点击“处理选中冲突”。本页只查看记录，不读取本地正文或远程操作文件。</p>
    <p v-if="data?.revoked" role="status">设备已撤销，以下历史记录不会再由该设备更新。</p>
    <p v-if="feedback" role="status">{{ feedback }}</p>
    <p v-if="loading" role="status">正在读取冲突记录…</p>
    <p v-else-if="error" class="error-message" role="alert">{{ error }} <button @click="load()">重试</button></p>
    <p v-else-if="data && !data.reported">此设备尚未成功上报冲突状态，不能判断是否存在冲突。请使用配套新版助手执行同步。</p>
    <p v-else-if="data && !data.items.length">本页没有已上报的未处理冲突；离线或尚未上报的本地变化可能不在其中。</p>
    <div v-else-if="data" class="sync-device-scroll" tabindex="0" aria-label="设备冲突记录">
      <table class="sync-device-table"><thead><tr><th scope="col">库内路径</th><th scope="col">原因</th><th scope="col">本地观察</th><th scope="col">最后确认基线</th><th scope="col">记录副本数</th><th scope="col">上报时间 / 范围</th><th scope="col">操作</th></tr></thead>
        <tbody><tr v-for="item in data.items" :key="item.path" :data-conflict-path="item.path">
          <td>{{ item.path }}</td><td>{{ reasons[item.reason] ?? item.reason }}</td><td>{{ item.localState === 'present' ? '文件存在' : item.localState === 'missing' ? '本地缺失' : '暂时无法读取' }}<small v-if="item.localSha256"> · {{ item.localSha256.slice(0, 12) }}</small></td>
          <td>{{ item.baselineVersion ? '版本 ' + item.baselineVersion : '尚无基线' }}</td><td>{{ item.copies }}</td><td>{{ time(item.reportedAt) }}<span v-if="item.scopeVersion !== data.scopeVersion || !item.inScope"> · 旧范围记录，须重新核对</span></td>
          <td><button :aria-label="'复制冲突路径 ' + item.path" @click="copy(item.path)">复制路径</button></td>
        </tr></tbody>
      </table>
    </div>
    <footer class="sync-pagination"><button :disabled="loading || cursors.length === 1" @click="previous">上一页</button><span>第 {{ cursors.length }} 页 · 每页 20 条</span><button :disabled="loading || !!error || !data?.nextCursor" @click="next">下一页</button></footer>
  </section>
</template>
