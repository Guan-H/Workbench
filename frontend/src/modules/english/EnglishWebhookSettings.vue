<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Input as AInput, Table as ATable, Tag as ATag } from 'ant-design-vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '../../shared/api/client'
import AppDialog from '../../shared/AppDialog.vue'
import AppPagination from '../../shared/AppPagination.vue'
import AppMessage, { type Notice } from '../../shared/AppMessage.vue'
import { displayTime, example, type HookStatus, type Credential, type Logs } from './types'
import { requestFormat, requestFields, requestLimits, webhookRequestGuide } from './request-guide'
const state=ref<HookStatus>(),logs=ref<Logs>(),page=ref(1),busy=ref(false),loading=ref(false),error=ref(''),token=ref(''),notice=ref<Notice>()
const confirm=ref<'rotate'|'disable'|'enable'>(),url=location.origin+'/api/v1/hooks/english'
let disposed=false,timer:ReturnType<typeof setTimeout>|undefined
const columns=[{title:'时间',key:'time',width:170},{title:'请求编号',dataIndex:'requestId',width:200},{title:'结果',key:'status',width:110},{title:'代码',dataIndex:'code',width:220}]
async function load(){loading.value=true;try{const [s,l]=await Promise.all([api<HookStatus>('/home/english/webhook'),api<Logs>(`/home/english/webhook/logs?page=${page.value}`)]);if(!disposed){state.value=s;logs.value=l}}catch(cause){if(!disposed)error.value=cause instanceof Error?cause.message:'读取接收配置失败。'}finally{if(!disposed)loading.value=false}}
function notify(text:string){notice.value={kind:'success',text};clearTimeout(timer);timer=setTimeout(()=>{notice.value=undefined},2000)}
async function change(){if(!state.value||!confirm.value||busy.value)return;busy.value=true;error.value='';token.value='';try{const result=await api<Credential>('/home/english/webhook',{method:'POST',body:JSON.stringify({baseRevision:state.value.revision,action:confirm.value})});if(!disposed){state.value=result.status;token.value=result.token||'';confirm.value=undefined;notify('接收配置已更新。')}}catch(cause){if(!disposed){error.value=(cause instanceof Error?cause.message:'结果未确认。')+' 请刷新核对；若凭证响应丢失，请重新生成，旧凭证将失效。';confirm.value=undefined;await load()}}finally{if(!disposed)busy.value=false}}
async function copyToken(){try{await navigator.clipboard.writeText(token.value);notify('凭证已复制。')}catch{error.value='浏览器不允许复制，请手动选择并复制凭证。'}}
async function copyGuide(jsonOnly=false){try{await navigator.clipboard.writeText(jsonOnly?example:webhookRequestGuide(url));notify(jsonOnly?'JSON 示例已复制。':'请求格式与限制已复制。')}catch{error.value='浏览器不允许复制，请手动选择下方内容；或通过 localhost / HTTPS 访问后重试。'}}
onMounted(()=>{void load()});onBeforeUnmount(()=>{disposed=true;token.value='';clearTimeout(timer)})
</script>
<template>
 <section class="home-card english-hook" aria-labelledby="english-hook-title">
  <header class="home-card-heading"><h2 id="english-hook-title">每日文章 Webhook</h2><AButton :loading="loading" :disabled="busy" @click="error='';load()">刷新接收记录</AButton></header>
  <AppMessage :notice="notice" @close="notice=undefined" />
  <p>接收英文文章、句子与单词，在学习页按日期展示最新一批。旧批次保留，同一 requestId 重试不重复。</p>
  <AAlert v-if="error" type="error" show-icon :message="error" />
  <template v-if="state"><div class="hook-actions"><ATag :color="state.enabled?'green':'default'">{{ state.enabled?'已启用':state.configured?'已停用':'未配置' }}</ATag><AButton type="primary" :disabled="busy" @click="confirm='rotate'">{{ state.configured?'重置推送凭证':'生成推送凭证' }}</AButton><AButton v-if="state.configured" :disabled="busy" @click="confirm=state.enabled?'disable':'enable'">{{ state.enabled?'停用接收':'启用接收' }}</AButton></div>
   <label>接收地址<AInput :value="url" readonly aria-label="每日文章接收地址" /></label>
   <AAlert v-if="!url.startsWith('https:')" type="warning" show-icon message="当前为本地 HTTP 调试地址，生产请使用 HTTPS。不要在不可信网络发送凭证。" />
   <div v-if="token" class="hook-secret"><AAlert type="warning" show-icon message="凭证仅在本次生成后显示，请保存到推送方。服务器只存摘要，离开页面后无法找回；重置会使旧凭证失效。" /><label>本次生成的凭证<AInput :value="token" readonly aria-label="新推送凭证" /></label><AButton @click="copyToken">复制凭证</AButton><AButton @click="token=''">隐藏凭证</AButton></div>
   <details><summary>请求格式与限制</summary><div class="hook-copy-actions"><AButton @click="copyGuide()">复制请求格式与限制</AButton><AButton @click="copyGuide(true)">复制 JSON 示例</AButton></div><p>{{ requestFormat }}</p><p>{{ requestFields }}</p><pre>{{ example }}</pre><p>{{ requestLimits }}</p></details>
  </template>
  <h3>接收记录</h3><p class="field-help">这里只记录通过凭证认证的提交结果；不保留凭证和失败正文。文章内容在主页历史批次查看。</p>
  <ATable :columns="columns" :data-source="logs?.items||[]" row-key="id" :pagination="false" :loading="loading" :scroll="{x:720,y:320}" size="small"><template #bodyCell="{column,record}"><template v-if="column.key==='time'">{{ displayTime(record.receivedAt) }}</template><template v-else-if="column.key==='status'">{{ record.status==='accepted'?'已接收':record.status==='duplicate'?'重复已确认':'已拒绝' }}</template></template></ATable>
  <nav class="hook-pagination"><span>共 {{ logs?.total||0 }} 条 · 10 条/页</span><AppPagination v-model:page="page" :pages="Math.max(1,Math.ceil((logs?.total||0)/10))" :total="logs?.total||0" :page-size="10" :disabled="loading||busy" @update:page="load" /></nav>
  <AppDialog v-if="confirm" label="确认接收配置"><section class="modal hook-dialog"><header><h2>{{ confirm==='rotate'?'生成新的推送凭证':confirm==='disable'?'停用英语接收':'启用英语接收' }}</h2></header><div><p>{{ confirm==='rotate'?'生成后旧凭证立即失效。新凭证只显示一次，请保存到推送方；已有批次不受影响。':confirm==='disable'?'停用后拒绝新推送，已有内容和记录保留。':'将使用当前凭证接收英语内容。' }}</p></div><footer><AButton :disabled="busy" @click="confirm=undefined">取消</AButton><AButton type="primary" :loading="busy" @click="change">确认</AButton></footer></section></AppDialog>
 </section>
</template>
<style scoped>
.hook-copy-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.english-hook{min-width:0}.english-hook>p{line-height:1.8}.english-hook label{display:grid;gap:8px;margin:16px 0}.hook-actions,.hook-secret{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:16px 0}.hook-secret>.ant-alert,.hook-secret>label{width:100%}.english-hook details{margin:20px 0;line-height:1.8}.english-hook pre{overflow:auto;max-height:360px;padding:16px;background:var(--color-bg);font-size:12px}.hook-pagination{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:16px;font-size:12px}.hook-dialog>div{padding:16px 24px;line-height:1.8}.hook-dialog>footer{margin:0;padding:16px 24px;border-top:1px solid var(--color-border)}
</style>
