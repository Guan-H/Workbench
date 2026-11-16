<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Input as AInput, InputNumber as AInputNumber } from 'ant-design-vue'
import { onBeforeUnmount, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import AppDialog from '../../shared/AppDialog.vue'
import AppPagination from '../../shared/AppPagination.vue'
import AppMessage, { type Notice } from '../../shared/AppMessage.vue'
import { ApiError } from '../../shared/api/client'
import { wordGameOperationId } from '../english/word-game'
import { dayLabel, timeLabel, loadLedger, loadLedgerHistory, previewOpening, saveOpening, type LedgerSummary, type LedgerHistory, type OpeningProjection, type OpeningChange } from './calendar-ledger'
const props=defineProps<{month:string;revision:number;username:string}>()
const summary=ref<LedgerSummary>(),history=ref<LedgerHistory>(),error=ref(''),loading=ref(false)
const opened=ref(false),editing=ref(false),busy=ref(false),page=ref(1),historyLoading=ref(false),historyError=ref('')
const date=ref(''),hours=ref(0),projection=ref<OpeningProjection>(),notice=ref<Notice>()
const pending=ref<{request:OpeningChange;operation:string}>(),storageError=ref(false)
const storageKey='workbench-calendar-opening:'+encodeURIComponent(props.username)
let serial=0,historySerial=0,disposed=false,noticeTimer:ReturnType<typeof setTimeout>|undefined
try { const saved=sessionStorage.getItem(storageKey);if(saved){pending.value=JSON.parse(saved);date.value=pending.value!.request.startDate;hours.value=pending.value!.request.openingMinutes/60} }
catch { storageError.value=true;error.value='本机待确认期初设置无法读取，请保留浏览器数据后重试。' }
function notify(text:string){notice.value={kind:'success',text};clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.value=undefined,2000)}
async function refresh(){
  const request=++serial;loading.value=true;error.value=''
  try {const value=await loadLedger(props.month);if(!disposed&&request===serial)summary.value=value}
  catch(cause){if(!disposed&&request===serial)error.value=cause instanceof Error?cause.message:'统计读取失败。'}
  finally {if(!disposed&&request===serial)loading.value=false}
}
async function refreshHistory(){
  const request=++historySerial;historyLoading.value=true;historyError.value=''
  try{const value=await loadLedgerHistory(page.value);if(!disposed&&request===historySerial)history.value=value}
  catch(cause){if(!disposed&&request===historySerial)historyError.value=cause instanceof Error?cause.message:'历史统计读取失败。'}
  finally{if(!disposed&&request===historySerial)historyLoading.value=false}
}
function showHistory(){opened.value=true;page.value=1;void refresh();void refreshHistory()}
function edit(){
  editing.value=true;projection.value=undefined;error.value=''
  if(!pending.value){date.value=summary.value?.opening.startDate??props.month+'-01';hours.value=(summary.value?.opening.openingMinutes??0)/60}
}
async function inspect(){
  if(!summary.value||busy.value||pending.value)return
  const minutes=hours.value*60
  if(!Number.isFinite(minutes)||minutes<0||Math.abs(minutes-Math.round(minutes))>0.000001){error.value='余额须为非负时长，精确到整分钟。';return}
  busy.value=true;error.value='';projection.value=undefined
  try{projection.value=await previewOpening({baseVersion:String(summary.value.opening.version),recordsRevision:summary.value.recordsRevision,startDate:date.value,openingMinutes:Math.round(minutes)})}
  catch(cause){const message=cause instanceof Error?cause.message:'预览失败。';await refresh();error.value=message}
  finally{busy.value=false}
}
async function save(){
  if(busy.value||storageError.value||(!pending.value&&!projection.value))return
  if(!pending.value){
    const value={request:projection.value!.request,operation:wordGameOperationId()}
    try{sessionStorage.setItem(storageKey,JSON.stringify(value))}catch{error.value='无法暂存待确认设置，请检查浏览器存储。';return}
    pending.value=value
  }
  busy.value=true;error.value=''
  try{
    await saveOpening(pending.value.request,pending.value.operation)
    sessionStorage.removeItem(storageKey);pending.value=undefined;projection.value=undefined;editing.value=false;opened.value=true
    notify('期初余额已保存。');await refresh()
  }catch(cause){
    error.value=cause instanceof Error?cause.message:'保存结果未确认，请重试原操作。'
    if(cause instanceof ApiError&&[400,409].includes(cause.status)){
      sessionStorage.removeItem(storageKey);pending.value=undefined;projection.value=undefined
      const message=error.value;await refresh();error.value=message
    }
  }finally{busy.value=false}
}
watch([()=>props.month,()=>props.revision],()=>{projection.value=undefined;void refresh();if(opened.value)void refreshHistory()},{immediate:true})
watch([date,hours],()=>{projection.value=undefined})
onBeforeUnmount(()=>{disposed=true;serial++;historySerial++;clearTimeout(noticeTimer)})
</script>

<template>
  <section class="work-stats" aria-label="加班与调休统计" :aria-busy="loading">
    <header><strong>{{ month }} · 工时统计</strong><AButton size="small" type="link" @click="showHistory">历史统计</AButton></header>
    <AAlert v-if="error&&!editing" type="error" :message="error" show-icon><template #action><AButton size="small" @click="refresh">重试</AButton></template></AAlert>
    <div v-if="summary&&summary.month===month" class="work-stat-grid">
      <div v-for="entry in [{label:'本月加班',value:summary.monthly.overtimeMinutes},{label:'本月调休',value:summary.monthly.timeOffMinutes},{label:'累计加班',value:summary.cumulative.overtimeMinutes},{label:'累计调休',value:summary.cumulative.timeOffMinutes}]" :key="entry.label"><span>{{ entry.label }}</span><strong>{{ timeLabel(entry.value) }}</strong><small>{{ dayLabel(entry.value) }}</small></div>
    </div>
    <p v-else role="status">{{ loading?'正在读取工时…':'暂无统计，请重试。' }}</p>
    <AppMessage :notice="notice" @close="notice=undefined" />
  </section>
  <AppDialog v-if="opened&&!editing" label="历史工时统计" :width="680">
    <section class="work-history">
      <header><h2>历史加班与调休</h2><AButton type="text" aria-label="关闭历史统计" :disabled="busy" @click="opened=false"><X :size="18" /></AButton></header>
      <div class="work-history-summary" v-if="summary"><div><strong>{{ summary.opening.startDate?'可调休余额':'已录入净时长' }}：{{ timeLabel(summary.netMinutes) }}</strong><small>{{ dayLabel(summary.netMinutes) }}</small></div><p>{{ summary.opening.startDate?`起算日 ${summary.opening.startDate} · 期初 ${timeLabel(summary.opening.openingMinutes??0)}`:'期初未设置，仅计算已录入加班减调休，不代表完整历史余额。' }}</p><AButton @click="edit">{{ summary.opening.startDate?'修改期初余额':'设置期初余额' }}</AButton><p>1小时加班抵1小时调休；1天=8小时。累计包含所有未删除记录，负值如实展示。</p></div>
      <div class="work-history-body">
        <AAlert v-if="historyError" type="error" :message="historyError" show-icon><template #action><AButton @click="refreshHistory">重试</AButton></template></AAlert>
        <p v-if="historyLoading" role="status">正在读取历史统计…</p>
        <p v-if="history&&!history.total">还没有加班或调休记录。</p>
        <article v-for="item in history?.items" :key="item.month"><strong>{{ item.month }}</strong><div><span>加班 {{ timeLabel(item.overtimeMinutes) }}</span><span>调休 {{ timeLabel(item.timeOffMinutes) }}</span></div></article>
      </div>
      <footer><span>共 {{ history?.total??0 }} 个月 · 10个月/页</span><AppPagination v-model:page="page" :pages="Math.max(1,Math.ceil((history?.total??0)/10))" :total="history?.total??0" :page-size="10" :disabled="historyLoading" show-page-summary @update:page="refreshHistory" /></footer>
    </section>
  </AppDialog>
  <AppDialog v-if="editing" label="设置期初余额" :width="540">
    <section class="opening-editor">
      <header><h2>设置期初余额</h2><AButton type="text" aria-label="关闭期初设置" :disabled="busy" @click="editing=false"><X :size="18" /></AButton></header>
      <div class="opening-fields">
        <AAlert v-if="error" type="error" :message="error" show-icon />
        <label for="opening-start-date">起算日期</label><AInput id="opening-start-date" v-model:value="date" type="date" min="1900-01-01" max="2100-12-31" :disabled="busy||!!pending" />
        <label for="opening-hours">期初可调休时长（小时）</label><AInputNumber id="opening-hours" v-model:value="hours" :min="0" :max="8760000" :precision="2" :step="0.5" :disabled="busy||!!pending" />
        <p>填写起算日开始前尚未使用的余额。该日起的记录参与余额计算，更早记录仍保留在累计和历史中，不再重复抵扣。</p>
        <div v-if="projection" class="opening-projection" role="status"><strong>保存后的余额：{{ timeLabel(projection.netMinutes) }}</strong><p>期初 {{ timeLabel(projection.request.openingMinutes) }} ＋ 起算日起加班 {{ timeLabel(projection.overtimeMinutes) }} － 调休 {{ timeLabel(projection.timeOffMinutes) }}</p><small>确认后替换期初设置，不修改或删除日历记录。</small></div>
        <p v-if="pending">保存结果尚未确认，重试将核对原操作，不重复设置。</p>
      </div>
      <footer><AButton :disabled="busy" @click="editing=false">关闭</AButton><AButton v-if="!pending" :loading="busy" @click="inspect">预览计算</AButton><AButton type="primary" :loading="busy" :disabled="storageError||(!projection&&!pending)" @click="save">{{ pending?'重试原保存':'确认保存' }}</AButton></footer>
    </section>
  </AppDialog>
</template>

<style scoped>
.work-stats{background:var(--color-paper-tint);border-radius:8px;padding:8px 12px}.work-stats header,.work-history header,.opening-editor header{display:flex;align-items:center;justify-content:space-between;gap:8px}.work-stats header{font-size:12px}.work-stat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px}.work-stat-grid>div{display:grid;grid-template-columns:1fr auto;gap:1px 5px;align-items:baseline}.work-stat-grid span,.work-stat-grid small{font-size:11px;color:var(--color-text-muted)}.work-stat-grid strong{font-size:13px;overflow-wrap:anywhere}.work-stat-grid small{grid-column:1/-1}.work-history,.opening-editor{display:flex;flex-direction:column;max-height:calc(100dvh - 64px)}.work-history header,.opening-editor header{padding:16px 22px;border-bottom:1px solid var(--color-border);flex-shrink:0}.work-history h2,.opening-editor h2{font-size:19px;margin:0}.work-history-summary{padding:14px 22px;border-bottom:1px solid var(--color-border);flex-shrink:0}.work-history-summary small{display:block}.work-history-summary p,.opening-fields p{font-size:12px;line-height:1.8;color:var(--color-text-muted);margin:8px 0}.work-history-body,.opening-fields{overflow:auto;min-height:0;padding:12px 22px}.work-history-body{flex:1}.work-history-body article{padding:12px;border:1px solid var(--color-border);border-radius:8px;margin-bottom:8px}.work-history-body article>div{display:flex;gap:18px;flex-wrap:wrap;margin-top:6px;font-size:13px}.work-history footer,.opening-editor footer{padding:14px 22px;border-top:1px solid var(--color-border);display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap;flex-shrink:0;font-size:12px}.opening-editor footer{justify-content:flex-end}.opening-fields>label{display:block;margin:12px 0 6px}.opening-fields .ant-input-number{width:100%}.opening-projection{padding:12px;background:var(--color-selection);border-radius:8px}.work-history button,.opening-editor button{min-height:40px}@media(max-width:600px){.work-history,.opening-editor{max-height:calc(100dvh - 32px)}.work-history-summary{padding:12px 16px}.work-history-body,.opening-fields{padding:12px 16px}.work-history header,.opening-editor header,.work-history footer,.opening-editor footer{padding:12px 16px}}
</style>
