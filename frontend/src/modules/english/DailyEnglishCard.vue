<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Input as AInput, RadioGroup as ARadioGroup, RadioButton as ARadioButton, Select as ASelect } from 'ant-design-vue'
import { BookOpen, RefreshCw } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api } from '../../shared/api/client'
import AppPagination from '../../shared/AppPagination.vue'
import ArticleReading from "./ArticleReading.vue"
import WordChallenge from './WordChallenge.vue'
import ReadAloudButton from './ReadAloudButton.vue'
import SpeechSettings from './SpeechSettings.vue'
import AppMessage from '../../shared/AppMessage.vue'
import { englishSpeechNotice, clearEnglishSpeechNotice, stopEnglishSpeech } from './speech'
import { displayTime, type Daily } from './types'
defineProps<{ username: string }>()
const emit=defineEmits<{study:[]}>()
const result=ref<Daily>(),date=ref(''),historyPage=ref(1),selectedBatch=ref<string>(),loading=ref(false),error=ref('')
const tab=ref<'articles'|'words'>('articles'),articlePage=ref(1),wordPage=ref(1)
const words=computed(()=>result.value?.latest?.content.words||[])
const articles=computed(()=>result.value?.latest?.content.articles||[])
const article=computed(()=>articles.value[articlePage.value-1])
const wordRows=computed(()=>words.value.slice((wordPage.value-1)*10,wordPage.value*10))
const historyOptions=computed(()=>{
 const options=result.value?.history.map((item,index)=>({value:item.id,label:`${historyPage.value===1&&index===0?'最新批次 · ':''}${displayTime(item.receivedAt)} · ${item.requestId}`}))||[]
 const current=result.value?.latest
 if(current&&!options.some(item=>item.value===current.id))options.unshift({value:current.id,label:`当前批次 · ${displayTime(current.receivedAt)} · ${current.content.requestId}`})
 return options
})
let serial=0,disposed=false
let controller: AbortController | undefined
const cache = new Map<string, Daily>()
watch(tab,()=>{wordPage.value=1})
watch([tab,date,selectedBatch,articlePage,wordPage],()=>stopEnglishSpeech())
function display(value: Daily) {
 result.value=value;date.value=value.date;selectedBatch.value=value.latest?.id;articlePage.value=1;wordPage.value=1
}
async function load(batch?:string, force=false) {
 const current=++serial;loading.value=true;error.value=''
 controller?.abort(); controller = new AbortController()
 const params=new URLSearchParams({page:String(historyPage.value)})
 params.set('date',date.value || new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()))
 if(batch)params.set('batch',batch)
 const key=params.toString()
 if(force)cache.clear()
 const cached=cache.get(key)
 if(cached) {
  display(cached)
  // Explicit batches are immutable; the day's latest still checks for new pushes.
  if(batch){loading.value=false;return}
 }
 try {
  const value=await api<Daily>(`/home/english?${params}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])})
  if(!disposed&&current===serial){
   cache.set(key,value)
   if(value.latest)cache.set(new URLSearchParams({...Object.fromEntries(params),batch:value.latest.id}).toString(),value)
   while(cache.size>30)cache.delete(cache.keys().next().value!)
   display(value)
  }
 }catch(cause){if(!disposed&&current===serial)error.value=cause instanceof Error?cause.message:'每日文章加载失败。'}
 finally{if(!disposed&&current===serial)loading.value=false}
}
async function openStudySource(source: import("./study-types").StudySource) { date.value=source.date;historyPage.value=1;await load(source.batchId);tab.value=source.articleIndex>=0?"articles":"words";if(source.articleIndex>=0)articlePage.value=source.articleIndex+1 }
defineExpose({openStudySource})
function changeDate(){historyPage.value=1;void load()}
function historyChange(){void load()}
onMounted(()=>{void load()});onBeforeUnmount(()=>{disposed=true;++serial;controller?.abort();cache.clear();stopEnglishSpeech();clearEnglishSpeechNotice()})
</script>
<template>
 <section class="home-card daily-english" aria-labelledby="daily-english-title" :aria-busy="loading">
  <AppMessage :notice="englishSpeechNotice" @close="clearEnglishSpeechNotice" />
  <header class="home-card-heading"><h2 id="daily-english-title"><BookOpen :size="18" />每日文章</h2><AButton :loading="loading" aria-label="刷新每日文章" @click="load(undefined,true)"><RefreshCw :size="15" /></AButton></header>
  <div class="english-study-controls"><AButton class="study-entry" @click="emit('study')">今日学习与词库</AButton><SpeechSettings /></div>
  <details class="english-history"><summary>日期与历史 · {{ date || '加载中' }}</summary>
  <div class="english-controls"><label>学习日期<AInput v-model:value="date" type="date" aria-label="英语学习日期" :disabled="loading" @change="changeDate" /></label><span>北京时间 · 可查看历史批次</span></div>
    <div v-if="result?.latest" class="english-batch"><label>接收批次<ASelect v-model:value="selectedBatch" aria-label="英语历史批次" :options="historyOptions" :disabled="loading" @change="()=>load(selectedBatch)" /></label><span>共 {{ result.total }} 批 · 当前批次 #{{ result.latest.id }}</span><AppPagination v-if="result.total>10" v-model:page="historyPage" :pages="Math.ceil(result.total/10)" :total="result.total" :page-size="10" :disabled="loading" @update:page="historyChange" /></div>
  </details>
  <AAlert v-if="error" type="error" show-icon :message="error" />
  <p v-if="loading&&!result" role="status">正在读取每日文章…</p>
  <template v-else-if="result">
   <div v-if="!result.latest" class="english-empty">这一天还没有收到英语推送。可在设置中配置接收入口。</div>
   <template v-else>
    <ARadioGroup v-model:value="tab" aria-label="英语内容类型" class="english-tabs"><ARadioButton value="articles">文章 / 句子</ARadioButton><ARadioButton value="words">单词</ARadioButton></ARadioGroup>
    <div class="english-content" :class="{ 'english-content-words': tab === 'words' }"><div class="english-scroll">
     <template v-if="tab==='articles'"><ArticleReading v-if="article" :article="article" /><p v-else>本批次没有文章或句子。</p></template>
     <template v-else><ul v-if="wordRows.length" class="english-words"><li v-for="(word,index) in wordRows" :key="index"><div><strong lang="en">{{ word.word }}</strong><span v-if="word.phonetic">{{ word.phonetic }}</span><ReadAloudButton kind="word" :text="word.word" :label="`朗读单词 ${word.word}`" compact /></div><p>{{ word.meaning }}</p><div v-if="word.example" class="english-example"><p lang="en">{{ word.example }}</p><ReadAloudButton :text="word.example" :label="`朗读例句 ${word.word}`" compact /></div></li></ul><p v-else>本批次没有单词。</p></template>
    </div><WordChallenge v-if="tab === 'words'" :key="result.latest.id" :username="username" :batch-id="result.latest.id" :word-count="words.length" :vocabulary="words" /></div>
    <footer v-if="tab==='articles'&&articles.length>1" class="english-pagination"><span>共 {{ articles.length }} 篇</span><AppPagination v-model:page="articlePage" :pages="articles.length" :total="articles.length" :page-size="1" /></footer>
    <footer v-else-if="tab!=='articles'&&words.length" class="english-pagination"><span>共 {{ words.length }} 个 · 10 个/页</span><AppPagination v-model:page="wordPage" :pages="Math.max(1,Math.ceil(words.length/10))" :total="words.length" :page-size="10" /></footer>
   </template>
  </template>
 </section>
</template>
<style scoped>
.english-study-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.daily-english{min-width:0}.english-history{margin:8px 0 14px}.english-history>summary{font-size:12px;color:var(--color-text-muted);cursor:pointer;padding:4px 0}.english-controls,.english-batch,.english-pagination{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:16px 0}.english-controls label,.english-batch label{display:grid;gap:6px;font-size:12px}.english-controls input{max-width:180px}.english-controls>span,.english-batch>span{color:var(--color-text-muted);font-size:12px}.english-batch label{flex:1;min-width:180px}.english-batch :deep(.ant-select){width:100%}.english-tabs{margin-bottom:16px}.english-scroll{font-size:14px;max-height:180px;overflow:auto;min-height:60px;line-height:1.9;overflow-wrap:anywhere}.english-article h3{margin:0 0 10px;font-size:16px}.english-article p{white-space:pre-wrap}.english-words{list-style:none;padding:0;margin:0}.english-words li{padding:14px 0;border-bottom:1px solid var(--color-border)}.english-words li>div{display:flex;gap:12px;flex-wrap:wrap}.english-words strong{font-size:19px}.english-words span{color:var(--color-text-muted)}.english-words p{margin:6px 0;white-space:pre-wrap}.english-empty{padding:14px 0;color:var(--color-text-muted)}.english-pagination{justify-content:space-between;border-top:1px solid var(--color-border);padding-top:12px;font-size:12px}
</style>

<style scoped>
.english-content-words { display: grid; grid-template-columns: minmax(0, 1fr) 184px; gap: 16px; align-items: start; }
.english-article-heading { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
.english-article-heading h3 { min-width: 0; }
.english-words li > .english-example { display: flex; align-items: start; flex-wrap: nowrap; gap: 8px; }
.english-example p { min-width: 0; flex: 1; }
@media (max-width: 1200px) {
  .english-content-words { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .english-content-words :deep(.word-challenge) { flex-direction: row; align-items: center; flex-wrap: wrap; }
  .english-content-words :deep(.word-challenge > div) { flex: 1; min-width: 130px; }
}
</style>
