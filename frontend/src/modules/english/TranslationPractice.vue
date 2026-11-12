<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Textarea as ATextarea } from 'ant-design-vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api, ApiError, write } from '../../shared/api/client'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'
import ReadAloudButton from './ReadAloudButton.vue'
import type { StudyPlan, StudySource, StudyTask } from './study-types'
const props=defineProps<{ username: string; planId: string; task: StudyTask }>()
const emit=defineEmits<{ stored: []; source: [source: StudySource] }>()
const current=ref({...props.task}),answer=ref(props.task.answer),saving=ref(false),submitting=ref(false),error=ref(''),conflicted=ref(false),confirm=ref(false)
type Body={baseRevision:string;answer:string;action:'draft'|'submit'|'rate';rating?:'good'|'improve'|'unknown'}
const pending=ref<{id:string;body:Body}>()
const dirty=computed(()=>answer.value!==current.value.answer)
const key=`workbench-translation:${encodeURIComponent(props.username)}:${props.task.id}`
let timer:ReturnType<typeof setTimeout>|undefined,disposed=false
function persist() {
  try {
    if(!dirty.value&&!pending.value)localStorage.removeItem(key)
    else localStorage.setItem(key,JSON.stringify({baseRevision:current.value.revision,answer:answer.value,pending:pending.value}))
    return true
  }catch{error.value='本机译文暂存失败，请保持页面打开并重试保存。';return false}
}
watch(answer,()=>{
  if(!persist())return
  clearTimeout(timer)
  if(!current.value.submitted&&!conflicted.value)timer=setTimeout(()=>{void save('draft')},1000)
})
watch(()=>props.task,task=>{if(!dirty.value&&!pending.value){current.value={...task};answer.value=task.answer}})
async function save(action:Body['action'],rating?:Body['rating']) {
  clearTimeout(timer)
  if(saving.value||conflicted.value||(current.value.completed&&!pending.value))return false
  if(!pending.value&&action==='draft'&&!dirty.value)return true
  saving.value=true;error.value=''
  pending.value??={id:crypto.randomUUID(),body:{baseRevision:current.value.revision,answer:answer.value,action,...(rating?{rating}:{})}}
  if(!persist()){saving.value=false;return false}
  try {
    const operation=pending.value
    const result=await write<StudyTask>(`/home/english/study/tasks/${current.value.id}`,'PUT',operation.body,operation.id,AbortSignal.timeout(15000))
    if(disposed)return false
    current.value=result;pending.value=undefined;persist();emit('stored')
    if(dirty.value&&!result.submitted)timer=setTimeout(()=>{void save('draft')},1000)
    return true
  }catch(cause){
    if(disposed)return false
    if(cause instanceof ApiError&&cause.status>=400&&cause.status<500){pending.value=undefined;conflicted.value=true;persist()}
    error.value=cause instanceof Error?cause.message:'保存结果未确认，请重试同一操作。'
    return false
  }finally{saving.value=false}
}
async function submit() {
  if(submitting.value||!answer.value.trim())return
  submitting.value=true
  try{if(await save('draft'))await save('submit')}finally{submitting.value=false}
}
async function adopt(accepted:boolean){
  confirm.value=false;if(!accepted)return
  try{
    const plan=await api<StudyPlan>(`/home/english/study/plans/${props.planId}`)
    const task=plan.tasks.find(item=>item.id===current.value.id)
    if(!task)throw new Error('服务器练习不存在。')
    current.value=task;answer.value=task.answer;pending.value=undefined;conflicted.value=false;error.value='';persist()
  }catch(cause){error.value=cause instanceof Error?cause.message:'读取失败，请重试。'}
}
onMounted(()=>{
  try{
    const stored=JSON.parse(localStorage.getItem(key)||'null')
    if(stored&&typeof stored.answer==='string'&&stored.answer.length<=8000){
      answer.value=stored.answer;pending.value=stored.pending
      if(!pending.value&&stored.baseRevision!==current.value.revision&&dirty.value){conflicted.value=true;error.value='服务器译文已有变化，本机输入保留，请核对后再继续。'}
      else if(pending.value)void save(pending.value.body.action)
    }
  }catch{error.value='本机译文记录无法读取，请保留浏览器数据。';conflicted.value=true}
})
onBeforeUnmount(()=>{clearTimeout(timer);persist();disposed=true})
</script>
<template>
  <section class="translation-practice" aria-label="短句翻译练习">
    <div class="translation-prompt"><span>{{ current.mode==='en-zh'?'英译中':'中译英' }}</span><p :lang="current.mode==='en-zh'?'en':'zh-CN'">{{ current.prompt }}</p><ReadAloudButton v-if="current.mode==='en-zh'" :text="current.prompt" label="朗读题目英文" /></div>
    <label :for="`translation-${current.id}`">我的译文</label>
    <ATextarea :id="`translation-${current.id}`" v-model:value="answer" :maxlength="8000" :rows="4" :disabled="current.submitted||submitting||!!pending&&pending.body.action!=='draft'" placeholder="先自己翻译，提交后查看参考表达" />
    <p role="status" class="translation-status">{{ pending?'译文待确认保存':saving?'正在保存译文':dirty?'本机译文已暂存，等待保存':'服务器译文已保存' }}</p>
    <AAlert v-if="error" type="error" show-icon :message="error"><template #action><AButton v-if="conflicted" @click="confirm=true">采用服务器内容</AButton><AButton v-else :loading="saving" @click="save(pending?.body.action||'draft')">重试保存</AButton></template></AAlert>
    <div v-if="!current.submitted" class="translation-actions"><AButton :loading="saving" :disabled="conflicted||submitting" @click="save('draft')">保存译文草稿</AButton><AButton type="primary" :loading="submitting" :disabled="!answer.trim()||conflicted||saving" @click="submit">提交并查看参考译文</AButton></div>
    <template v-else><div class="translation-reference"><h4>参考译文</h4><p :lang="current.mode==='zh-en'?'en':'zh-CN'">{{ current.reference }}</p><ReadAloudButton v-if="current.mode==='zh-en'&&current.reference" :text="current.reference" label="朗读参考英文" /></div><p class="translation-self-note">翻译可以有不同表达。以下是你的自评，不是系统自动评分。</p><div v-if="!current.completed" class="translation-actions"><AButton v-for="rating in (['good','improve','unknown'] as const)" :key="rating" :disabled="saving||conflicted" @click="save('rate',rating)">{{ rating==='good'?'基本表达正确':rating==='improve'?'需要改进':'不会' }}</AButton></div><p v-else role="status">自评已保存：{{ current.rating==='good'?'基本表达正确':current.rating==='improve'?'需要改进':'不会' }}。后续复习已安排。</p></template>
    <AButton v-if="current.sources[0]" type="link" @click="emit('source',current.sources[0])">回看原文章 · {{ current.sources[0].date }}</AButton>
    <ConfirmDialog v-if="confirm" message="采用服务器内容并放弃本机尚未确认的译文？已保存的服务器记录不会撤销。" confirm-label="采用服务器内容" @answer="adopt" />
  </section>
</template>
<style scoped>
.translation-practice{display:grid;gap:12px}.translation-prompt,.translation-reference{padding:16px;background:var(--color-selection);border-radius:8px}.translation-prompt p,.translation-reference p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9;margin:8px 0}.translation-prompt>span,.translation-status,.translation-self-note{font-size:12px;color:var(--color-text-muted)}.translation-actions{display:flex;gap:8px;flex-wrap:wrap}.translation-actions button{min-height:40px}.translation-reference h4{margin:0}.translation-status{margin:0}
</style>
