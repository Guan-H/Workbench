<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Input as AInput, InputNumber as AInputNumber, RadioGroup as ARadioGroup, RadioButton as ARadioButton, Tag as ATag } from 'ant-design-vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { X, RefreshCw } from 'lucide-vue-next'
import AppDialog from '../../shared/AppDialog.vue'
import AppPagination from '../../shared/AppPagination.vue'
import AppMessage, { type Notice } from '../../shared/AppMessage.vue'
import { api, write } from '../../shared/api/client'
import WordChallenge from './WordChallenge.vue'
import TranslationPractice from './TranslationPractice.vue'
import ReadAloudButton from './ReadAloudButton.vue'
import SpeechSettings from './SpeechSettings.vue'
import { stopEnglishSpeech } from './speech'
import type { StudyDashboard, StudyItems, StudyPlan, StudySettings, StudySource } from './study-types'
const props=withDefaults(defineProps<{username:string;embedded?:boolean}>(),{embedded:false})
const emit=defineEmits<{close:[];source:[source:StudySource]}>()
const data=ref<StudyDashboard>(),settings=ref<StudySettings>(),items=ref<StudyItems>(),tab=ref('today'),query=ref(''),page=ref(1),loading=ref(false),busy=ref(false),error=ref(''),notice=ref<Notice>()
const sentenceMode=ref<'en-zh'|'zh-en'>('en-zh'),selected=ref('')
const taskPage=ref(1),wrongKind=ref<'word'|'sentence'>('word')
let disposed=false,serial=0,timer:ReturnType<typeof setTimeout>|undefined,noticeTimer:ReturnType<typeof setTimeout>|undefined
const plan=computed(()=>data.value?.plan)
const wordTasks=computed(()=>plan.value?.tasks.filter(task=>task.mode==='matching'||task.mode==='spelling')||[])
const completedWords=computed(()=>wordTasks.value.filter(task=>task.completed).length)
const sentences=computed(()=>plan.value?.tasks.filter(task=>task.mode===sentenceMode.value)||[])
const sentence=computed(()=>sentences.value.find(task=>task.id===selected.value)||sentences.value.find(task=>!task.completed)||sentences.value[0])
const ratingName=(mode:string)=>mode==='matching'?'配对':mode==='spelling'?'拼写':mode==='en-zh'?'英译中自评':'中译英自评'
function notify(text:string){notice.value={kind:'success',text};clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{notice.value=undefined},2000)}
async function load(){
  loading.value=true;error.value=''
  try{const result=await api<StudyDashboard>('/home/english/study');if(!disposed){data.value=result;settings.value={...result.settings}}}
  catch(cause){if(!disposed)error.value=cause instanceof Error?cause.message:'读取学习记录失败。'}
  finally{if(!disposed)loading.value=false}
}
async function refreshPlan(){
  if(!plan.value)return
  try{const result=await api<StudyPlan>(`/home/english/study/plans/${plan.value.id}`);if(!disposed&&data.value)data.value={...data.value,plan:result}}
  catch(cause){if(!disposed)error.value=cause instanceof Error?cause.message:'读取计划失败。'}
}
async function start(){
  if(busy.value)return
  busy.value=true;error.value=''
  try{const result=await write<StudyPlan>('/home/english/study/plans','POST');if(!disposed&&data.value){data.value={...data.value,plan:result};notify('今日计划已保存。')}}
  catch(cause){if(!disposed)error.value=(cause instanceof Error?cause.message:'结果未确认。')+' 可重试读取同一天的计划，不会重复生成。'}
  finally{if(!disposed)busy.value=false}
}
async function saveSettings(){
  if(!settings.value||busy.value)return
  busy.value=true;error.value=''
  try{const value=settings.value;const result=await write<StudySettings>('/home/english/study/settings','PUT',{baseRevision:value.revision,newLimit:value.newLimit,reviewLimit:value.reviewLimit,sentenceLimit:value.sentenceLimit});if(!disposed){settings.value=result;notify('学习数量已保存，将用于下次生成的新计划。')}}
  catch(cause){if(!disposed)error.value=(cause instanceof Error?cause.message:'保存未确认。')+' 请刷新核对后再修改。'}
  finally{if(!disposed)busy.value=false}
}
async function loadItems(){
  const request=++serial;loading.value=true
  const params=new URLSearchParams({page:String(page.value),query:query.value,kind:tab.value==='wrong'?wrongKind.value:'word',wrong:String(tab.value==='wrong')})
  try{const result=await api<StudyItems>(`/home/english/study/items?${params}`);if(!disposed&&request===serial)items.value=result}
  catch(cause){if(!disposed&&request===serial)error.value=cause instanceof Error?cause.message:'读取词库失败。'}
  finally{if(!disposed&&request===serial)loading.value=false}
}
watch(tab,()=>{stopEnglishSpeech();page.value=1;query.value='';if(tab.value==='words'||tab.value==='wrong')void loadItems();else void refreshPlan()})
watch(query,()=>{clearTimeout(timer);page.value=1;timer=setTimeout(()=>{void loadItems()},250)})
watch(sentenceMode,()=>{selected.value='';stopEnglishSpeech()})
watch(wrongKind,()=>{page.value=1;void loadItems()})
onMounted(load)
onBeforeUnmount(()=>{disposed=true;++serial;clearTimeout(timer);clearTimeout(noticeTimer);stopEnglishSpeech()})
</script>
<template>
  <component :is="embedded?'div':AppDialog" label="英语学习" :width="embedded?undefined:960">
    <section class="study-dialog" :class="{'study-embedded':embedded}" aria-label="英语学习">
      <header class="study-heading"><div><h2>英语学习</h2><p>历史推送词库 · 四级范围由推送端提供</p><SpeechSettings /></div><div><AButton type="text" :loading="loading" aria-label="刷新学习记录" @click="load"><RefreshCw :size="18" /></AButton><AButton v-if="!embedded" type="text" aria-label="关闭英语学习" @click="emit('close')"><X :size="20" /></AButton><AButton v-else @click="emit('close')">返回每日文章</AButton></div></header>
      <div class="study-scroll">
        <AppMessage :notice="notice" @close="notice=undefined" />
        <AAlert v-if="error" type="error" show-icon :message="error" />
        <p v-if="loading&&!data" role="status">正在整理真实历史词汇及学习记录…</p>
        <template v-if="data">
          <div class="study-summary"><ATag>词库 {{ data.words }}</ATag><ATag>累计错词 {{ data.wrongWords }}</ATag><ATag>到期练习 {{ data.due }}</ATag></div>
          <ARadioGroup v-model:value="tab" aria-label="学习视图" class="study-tabs"><ARadioButton value="today">今日学习</ARadioButton><ARadioButton value="words">个人词库</ARadioButton><ARadioButton value="wrong">累计错词</ARadioButton><ARadioButton value="sentences">短句练习</ARadioButton></ARadioGroup>
          <template v-if="tab==='today'">
            <details class="study-settings"><summary>每日数量</summary><div v-if="settings" class="study-setting-fields"><label>新词 / 天<AInputNumber v-model:value="settings.newLimit" aria-label="每日新词" :min="1" :max="50" /></label><label>复习项 / 天<AInputNumber v-model:value="settings.reviewLimit" aria-label="每日复习" :min="1" :max="100" /></label><label>短句 / 每方向<AInputNumber v-model:value="settings.sentenceLimit" aria-label="每日短句" :min="1" :max="20" /></label><AButton :loading="busy" @click="saveSettings">保存学习数量</AButton></div><p>已有今日计划不重排，新数量用于下次生成计划。配对、拼写分别练习，不把一次答对当成掌握。</p></details>
            <div v-if="!plan" class="study-empty"><p>先复习旧词，再学习新词；短句使用文章中已提供的逐句对应内容。</p><AButton type="primary" :loading="busy" :disabled="data.words+data.sentences===0" @click="start">生成今日计划</AButton><p v-if="data.words+data.sentences===0">先通过推送接收词汇或逐句文章，再生成计划。</p></div>
            <template v-else>
              <h3>{{ plan.date }} · 词汇任务 {{ completedWords }} / {{ wordTasks.length }}</h3><p>先处理复习任务；配对和拼写分别累计，答错安排次日重练，跨日答对逐步延长到 1、3、7、14 天。</p>
              <WordChallenge v-if="plan.batchId&&plan.vocabulary.length" :key="plan.id" :username="username" :batch-id="plan.batchId" :study-plan-id="plan.id" :vocabulary="plan.vocabulary" :word-count="plan.vocabulary.length" :matching-game="plan.matchingGame" :spelling-game="plan.spellingGame" @stored="refreshPlan" />
              <p v-else>当前没有可安排的词汇；收到推送后可在下一份新计划中安排。</p>
              <ul class="study-task-list"><li v-for="task in wordTasks.slice((taskPage-1)*10,taskPage*10)" :key="task.id"><span>{{ task.prompt }}</span><ATag>{{ ratingName(task.mode) }}</ATag><ATag>{{ task.kind==='review'?'复习':'新词' }}</ATag><span>{{ task.completed?'本次已完成':'待练习' }}</span></li></ul>
              <AppPagination v-if="wordTasks.length" v-model:page="taskPage" :pages="Math.max(1,Math.ceil(wordTasks.length/10))" :total="wordTasks.length" :page-size="10" />
              <AButton @click="tab='sentences'">练习短句翻译</AButton>
            </template>
          </template>
          <template v-else-if="tab==='words'||tab==='wrong'">
            <ARadioGroup v-if="tab==='wrong'" v-model:value="wrongKind" aria-label="错题类型"><ARadioButton value="word">错词</ARadioButton><ARadioButton value="sentence">错句（自评）</ARadioButton></ARadioGroup>
            <label class="study-search">搜索单词或释义<AInput v-model:value="query" :maxlength="200" allow-clear aria-label="搜索学习词库" /></label>
            <p v-if="!items?.items.length&&!loading">{{ tab==='wrong'?'还没有累计错词。':'还没有符合条件的历史词汇。' }}</p>
            <ul v-else class="study-word-list"><li v-for="item in items?.items" :key="item.id"><div><strong lang="en">{{ item.name }}</strong><ReadAloudButton :kind="item.kind==='word'?'word':'sentence'" :text="item.name" :label="`朗读词库单词 ${item.name}`" compact /></div><p>{{ item.word?.phonetic }} {{ item.meaning }}</p><p v-if="item.word?.example" lang="en">{{ item.word.example }}</p><div class="study-progress"><span v-for="entry in item.progress" :key="entry.mode">{{ ratingName(entry.mode) }}：累计错 {{ entry.mistakes }} 次 · 复习 {{ entry.nextDate || '尚未安排' }}</span><span v-if="!item.progress.length">未学习</span></div><div class="study-sources"><AButton v-for="source in item.sources" :key="`${source.batchId}:${source.articleIndex}`" type="link" size="small" @click="emit('source',source)">来源 {{ source.date }} · #{{ source.batchId }}</AButton></div></li></ul>
            <AppPagination v-if="items" v-model:page="page" :pages="Math.max(1,Math.ceil(items.total/10))" :total="items.total" :page-size="10" :disabled="loading" @update:page="loadItems" />
          </template>
          <template v-else>
            <p v-if="!plan">先在“今日学习”生成计划。</p>
            <template v-else><ARadioGroup v-model:value="sentenceMode" aria-label="短句翻译方向"><ARadioButton value="en-zh">英译中</ARadioButton><ARadioButton value="zh-en">中译英</ARadioButton></ARadioGroup><p>先自行翻译，再查看参考表达并自评。没有逐句数据的旧文章不会自动生成题目。</p><div class="study-sentence-list"><AButton v-for="(task,index) in sentences" :key="task.id" :type="sentence?.id===task.id?'primary':'default'" @click="selected=task.id">第 {{ index+1 }} 句{{ task.completed?' · 已自评':'' }}</AButton></div><TranslationPractice v-if="sentence" :key="sentence.id" :username="username" :plan-id="plan.id" :task="sentence" @stored="refreshPlan" @source="emit('source',$event)" /><p v-else>本计划没有该方向的短句任务，可能尚无配对句子，或所有句子尚未到复习日期。</p></template>
          </template>
        </template>
      </div>
      <footer v-if="!embedded" class="study-footer"><span>学习记录以服务器确认结果为准</span><AButton @click="emit('close')">关闭</AButton></footer>
    </section>
  </component>
</template>
<style scoped>
.study-dialog.study-embedded{max-height:none}.study-embedded .study-scroll{overflow:visible}.study-embedded .study-heading{padding-inline:0}.study-embedded .study-scroll{padding-inline:0}
.study-dialog{display:flex;flex-direction:column;max-height:calc(100dvh - 80px)}.study-heading{display:flex;justify-content:space-between;align-items:start;padding:22px 24px 16px;border-bottom:1px solid var(--color-border);gap:12px}.study-heading h2{font-size:21px;margin:0 0 6px}.study-heading p,.study-footer span{font-size:12px;color:var(--color-text-muted);margin:0}.study-heading>div:last-child{display:flex}.study-scroll{padding:20px 24px;overflow:auto;min-height:0}.study-summary,.study-tabs,.study-settings,.study-search{margin-bottom:16px}.study-tabs{display:flex;flex-wrap:wrap;gap:6px}.study-settings summary{cursor:pointer}.study-setting-fields{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin-top:14px}.study-setting-fields label{display:grid;gap:6px}.study-setting-fields .ant-input-number{width:100px}.study-empty{padding:20px 0}.study-task-list,.study-word-list{list-style:none;padding:0}.study-task-list li{display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--color-border);padding:10px 0}.study-task-list li>span:first-child{flex:1;min-width:120px;overflow-wrap:anywhere}.study-search{display:grid;gap:8px}.study-word-list li{padding:14px 0;border-bottom:1px solid var(--color-border)}.study-word-list li>div:first-child{display:flex;gap:12px;align-items:center}.study-word-list strong{font-size:18px}.study-word-list p{white-space:pre-wrap;overflow-wrap:anywhere}.study-progress{display:grid;gap:6px;color:var(--color-text-muted);font-size:12px}.study-sources,.study-sentence-list{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.study-footer{border-top:1px solid var(--color-border);padding:14px 24px;display:flex;justify-content:space-between;align-items:center;gap:12px}.study-footer button,.study-heading button{min-height:40px}.study-scroll>p{line-height:1.8}@media(max-width:600px){.study-dialog{max-height:calc(100dvh - 32px)}.study-heading,.study-scroll{padding:16px}.study-footer{padding:12px 16px}.study-tabs label{min-height:40px}.study-footer span{max-width:65%}.study-setting-fields{align-items:start}.study-task-list{max-height:260px;overflow:auto}}
</style>
