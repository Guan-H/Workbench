<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Card as ACard, RadioGroup as ARadioGroup, Radio as ARadio, Tag as ATag, Spin as ASpin } from 'ant-design-vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowLeft, BookOpen, BookmarkCheck, Shuffle, Star } from 'lucide-vue-next'
import { api, ApiError, write } from '../../shared/api/client'
import AppPagination from '../../shared/AppPagination.vue'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'
import AppMessage, { type Notice } from '../../shared/AppMessage.vue'
import ArticleReading from './ArticleReading.vue'
import ReadAloudButton from './ReadAloudButton.vue'
import WordExample from './WordExample.vue'
import ReadingAddDialog from './ReadingAddDialog.vue'
import ReadingSourcesDialog from './ReadingSourcesDialog.vue'
import { stopEnglishSpeech } from './speech'
import type { CourseChange, CourseDetail, CoursePage, SentencePage } from './course-types'

const props = defineProps<{ username: string; section: 'reading' | 'sentences' | 'collection' }>()
const listing = ref<CoursePage>(), lesson = ref<CourseDetail>(), page = ref(1)
const listScroll=ref<HTMLElement>()
const adding = ref(false), sources = ref(false)
const loading = ref(false), saving = ref(false), error = ref('')
const filter = ref<'favorite' | 'review' | 'marked'>('favorite'), sentences = ref<SentencePage>()
const sentenceMode = computed(() => props.section === 'sentences' || props.section === 'collection' && filter.value === 'marked')
const conflict = ref(false), confirm = ref(false), notice = ref<Notice>()
const choices = ref<Record<number, number | undefined>>({}), practicing = ref<number[]>([])
const pending = ref<{ operation: string; request: CourseChange }>()
const pendingKey = (id: string) => 'workbench-course:' + encodeURIComponent(props.username) + ':' + id
const currentSentence = computed(() => {
  const position = lesson.value?.summary.position || ''
  return position.startsWith('sentence-') ? Number(position.slice(9)) : -1
})
const selectedSentence = computed(() => lesson.value?.sentences[currentSentence.value])
const title = computed(() => props.section === 'reading' ? '找一篇想读的文章' : props.section === 'sentences' ? '从一句话开始' : '我的积累')
const busy = computed(() => loading.value || saving.value || !!pending.value)
let disposed = false
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function show(value: CourseDetail) {
  lesson.value = value
  choices.value = Object.fromEntries(value.questions.map((question, index) => [index, question.selected ?? undefined]))
  practicing.value = []
  stopEnglishSpeech()
}
function added(value: CourseDetail) { adding.value = false; show(value) }
async function list() {
  loading.value = true; error.value = ''
  try {
    if (sentenceMode.value) {
      const value = await api<SentencePage>('/home/english/courses/sentences?page=' + page.value + '&markedOnly=' + (props.section === 'collection'))
      if (!disposed) sentences.value = value
    } else {
      const value = await api<CoursePage>('/home/english/courses?page=' + page.value + '&filter=' + (props.section === 'collection' ? filter.value : 'all'))
      if (!disposed) listing.value = value
    }
  } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : '阅读材料读取失败。' }
  finally { if (!disposed) { loading.value = false; await nextTick(); if(listScroll.value)listScroll.value.scrollTop=0 } }
}
async function open(id: string, sentenceIndex?: number) {
  loading.value = true; error.value = ''; conflict.value = false; pending.value = undefined
  try {
    const value = await api<CourseDetail>('/home/english/courses/' + id)
    if (disposed) return
    show(value)
    const stored = sessionStorage.getItem(pendingKey(id))
    if (stored) {
      pending.value = JSON.parse(stored)
      error.value = '有一项学习记录尚未确认，请重试原操作。'
    } else if (sentenceIndex !== undefined) {
      const position = sentenceIndex < 0 ? 'article' : 'sentence-' + sentenceIndex
      if (value.summary.position !== position) await save({ action: 'position', position })
    }
  } catch (cause) { if (!disposed) error.value = cause instanceof Error ? cause.message : '阅读材料读取失败。' }
  finally { if (!disposed) loading.value = false }
}
async function save(change?: Omit<CourseChange, 'baseRevision'>) {
  if (!lesson.value || saving.value || conflict.value) return
  const id = lesson.value.summary.id
  if (!pending.value && change) {
    const value = { operation: crypto.randomUUID(), request: { ...change, baseRevision: lesson.value.summary.revision } }
    try { sessionStorage.setItem(pendingKey(id), JSON.stringify(value)) }
    catch { error.value = '无法暂存待确认操作，请检查浏览器存储后重试。'; return }
    pending.value = value
  }
  if (!pending.value) return
  saving.value = true; error.value = ''
  const operation = pending.value
  try {
    const value = await write<CourseDetail>('/home/english/courses/' + id + '/progress', 'PUT', operation.request, operation.operation)
    sessionStorage.removeItem(pendingKey(id))
    if (disposed) return
    pending.value = undefined
    const unsent = { ...choices.value }
    const retrying = practicing.value.filter(index => operation.request.action !== 'answer' || operation.request.index !== index)
    show(value)
    for (const [key, choice] of Object.entries(unsent)) {
      const index = Number(key)
      if (value.questions[index]?.selected === null || retrying.includes(index)) choices.value[index] = choice
    }
    practicing.value = retrying
    notice.value = { kind: 'success', text: '学习记录已保存。' }
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => { notice.value = undefined }, 2000)
  } catch (cause) {
    if (!disposed) {
      conflict.value = cause instanceof ApiError && cause.status === 409
      error.value = cause instanceof Error ? cause.message : '保存结果尚未确认，请重试原操作。'
    }
  } finally { if (!disposed) saving.value = false }
}
async function adopt(answer: boolean) {
  confirm.value = false
  if (!answer || !lesson.value) return
  sessionStorage.removeItem(pendingKey(lesson.value.summary.id))
  pending.value = undefined
  await open(lesson.value.summary.id)
}
async function back() {
  if (busy.value) return
  lesson.value = undefined; stopEnglishSpeech()
  await list()
}
function again(index: number) {
  practicing.value.push(index); choices.value[index] = undefined
}
function changeFilter(value: 'favorite' | 'review' | 'marked') {
  filter.value = value; page.value = 1
  void list()
}
async function another() {
  const candidates = listing.value?.items.filter(item => item.id !== lesson.value?.summary.id) || []
  if (!candidates.length) return
  const next = candidates[Math.floor(Math.random() * candidates.length)]!
  await open(next.id, -1)
}
onMounted(list)
onBeforeUnmount(() => { disposed = true; clearTimeout(noticeTimer); stopEnglishSpeech() })
</script>

<template>
  <section class="course-learning" aria-label="阅读与练习" :aria-busy="loading || saving">
    <AppMessage :notice="notice" @close="notice = undefined" />
    <AAlert v-if="error" type="error" show-icon :message="error">
      <template #action>
        <AButton v-if="conflict" @click="confirm = true">核对服务器进度</AButton>
        <AButton v-else-if="pending" :loading="saving" @click="save()">重试保存</AButton>
        <AButton v-else :disabled="loading" @click="lesson ? open(lesson.summary.id) : list()">重试读取</AButton>
      </template>
    </AAlert>
    <ASpin v-if="loading" tip="正在读取…" />
    <template v-if="!lesson">
      <header class="course-heading"><div><h2><BookOpen :size="20" />{{ title }}</h2><p>{{ section === 'reading' ? '挑感兴趣的内容读，不用按顺序，也不用完成整套题。' : section === 'sentences' ? '先自己理解，再按需要展开词义、结构和译文。' : '收藏想再读的文章，回看不懂的句子和错题。' }}</p></div><div v-if="section === 'reading'" class="course-sections"><AButton :disabled="loading" @click="sources = true">内容来源</AButton><AButton type="primary" :disabled="loading" @click="adding = true">添加文章</AButton></div></header>
      <div v-if="section === 'collection'" class="course-sections" aria-label="积累内容筛选">
        <AButton :type="filter === 'favorite' ? 'primary' : 'default'" :disabled="loading" @click="changeFilter('favorite')">收藏文章</AButton>
        <AButton :type="filter === 'marked' ? 'primary' : 'default'" :disabled="loading" @click="changeFilter('marked')">标记短句</AButton>
        <AButton :type="filter === 'review' ? 'primary' : 'default'" :disabled="loading" @click="changeFilter('review')">待复习内容</AButton>
      </div>
      <template v-if="sentenceMode">
        <div ref="listScroll" class="course-list-scroll">
        <div class="sentence-list">
          <ACard v-for="item in sentences?.items" :key="item.courseId + ':' + item.sentenceIndex" class="sentence-card">
            <div class="course-word"><p lang="en">{{ item.text }}</p><ReadAloudButton :text="item.text" label="朗读短句" compact /></div>
            <small>来自《{{ item.title }}》 <span v-if="item.marked"> · 已标记</span></small>
            <div class="course-sections"><AButton type="primary" :disabled="loading" @click="open(item.courseId, item.sentenceIndex)">看看怎么理解</AButton><AButton :disabled="loading" @click="open(item.courseId, -1)">回看文章</AButton></div>
          </ACard>
        </div>
        <p v-if="!loading && !sentences?.total">暂无标记的短句。遇到不懂的句子时，可以先留在这里。</p>
        </div>
        <footer v-if="sentences" class="course-pagination"><span>共 {{ sentences.total }} 句 · 10 句/页</span><AppPagination v-model:page="page" :pages="Math.max(1,Math.ceil(sentences.total / 10))" :total="sentences.total" :page-size="10" :disabled="loading" show-page-summary @update:page="list" /></footer>
      </template>
      <template v-else>
        <div ref="listScroll" class="course-list-scroll">
        <div class="course-list">
          <ACard v-for="item in listing?.items" :key="item.id" class="course-card">
            <ATag>{{ item.kind === 'nasa' ? '原版科普 · 未分级' : item.kind === 'manual' ? '自行添加' : '入门短文' }}</ATag><ATag v-if="item.favorite"><Star :size="12" />已收藏</ATag>
            <h3>{{ item.title }}</h3><p>{{ item.focus }}</p><small>{{ item.source }}</small>
            <p v-if="item.reviewCount">{{ item.reviewCount }} 项待复习</p>
            <AButton type="primary" :disabled="loading" @click="open(item.id)">{{ item.revision === '0' ? '打开阅读' : '继续阅读' }}</AButton>
          </ACard>
        </div>
        <p v-if="!loading && !listing?.total">{{ section === 'collection' ? '这里还没有内容。阅读时可以收藏文章或标记句子。' : '暂时没有阅读材料。' }}</p>
        </div>
        <footer v-if="listing" class="course-pagination"><span>共 {{ listing.total }} 篇 · 10 篇/页</span><AppPagination v-model:page="page" :pages="Math.max(1,Math.ceil(listing.total / 10))" :total="listing.total" :page-size="10" :disabled="loading" show-page-summary @update:page="list" /></footer>
      </template>
    </template>
    <template v-else>
      <header class="course-heading"><AButton :disabled="busy" @click="back"><ArrowLeft :size="15" />返回列表</AButton><div class="course-sections"><AButton :disabled="busy" :type="lesson.summary.favorite ? 'primary' : 'default'" @click="save({ action: 'favorite', favorite: !lesson.summary.favorite })"><Star :size="15" />{{ lesson.summary.favorite ? '取消收藏' : '收藏文章' }}</AButton><AButton v-if="section === 'reading' && (listing?.items.length || 0) > 1" :disabled="busy" @click="another"><Shuffle :size="15" />换一篇</AButton></div></header>
      <h2>{{ lesson.summary.title }}</h2><p class="course-source">{{ lesson.summary.source }}</p>
      <p v-if="lesson.origin" class="course-source"><a v-if="lesson.origin.url" :href="lesson.origin.url" target="_blank" rel="noopener noreferrer">查看来源</a><span v-if="lesson.origin.publishedAt"> · {{ new Date(lesson.origin.publishedAt).toLocaleDateString('zh-CN') }}</span><template v-if="lesson.origin.licenseUrl"> · <a :href="lesson.origin.licenseUrl" target="_blank" rel="noopener noreferrer">使用说明</a></template></p>
      <nav class="course-sections" aria-label="阅读位置">
        <AButton :type="lesson.summary.position === 'article' ? 'primary' : 'default'" :disabled="busy" @click="save({ action: 'position', position: 'article' })">阅读短文</AButton>
        <AButton v-for="(sentence, index) in lesson.sentences" :key="sentence.text" :type="currentSentence === index ? 'primary' : 'default'" :disabled="busy" @click="save({ action: 'position', position: 'sentence-' + index })">句子 {{ index + 1 }}{{ lesson.marked.includes(index) ? ' · 已标记' : '' }}</AButton>
        <AButton v-if="lesson.questions.length" :type="lesson.summary.position === 'practice' ? 'primary' : 'default'" :disabled="busy" @click="save({ action: 'position', position: 'practice' })">随手练习</AButton>
      </nav>
      <p v-if="pending" role="status">学习记录待确认，请重试保存。</p>
      <ACard v-if="lesson.summary.position === 'article'" class="course-body">
        <ArticleReading :article="lesson.article" />
        <details v-if="lesson.words.length" class="course-vocabulary"><summary>词语随读 · {{ lesson.words.length }} 个</summary><article v-for="word in lesson.words" :key="word.word"><div class="course-word"><strong lang="en">{{ word.word }}</strong><ReadAloudButton kind="word" :text="word.word" :label="'朗读词语 ' + word.word" compact /></div><p>{{ word.meaning }}</p><WordExample v-if="word.example" :word="word.word" :example="word.example" :translation="word.exampleTranslation" /></article></details>
        <p v-if="!lesson.sentences.length && !lesson.questions.length" class="course-source">这篇文章尚未提供句子解析或练习，可以直接阅读、朗读和收藏。</p>
      </ACard>
      <ACard v-else-if="selectedSentence" :key="currentSentence" class="course-body course-sentence">
        <template v-if="selectedSentence">
        <div class="course-word"><h3 lang="en">{{ selectedSentence.text }}</h3><ReadAloudButton :text="selectedSentence.text" label="朗读当前句子" /></div>
        <details><summary>语境词义与短语</summary><p>{{ selectedSentence.vocabulary }}</p></details>
        <details><summary>词形变化</summary><p>{{ selectedSentence.forms }}</p></details>
        <details><summary>句子结构</summary><p>{{ selectedSentence.structure }}</p></details>
        <details><summary>参考译文</summary><p>{{ selectedSentence.translation }}</p></details>
        <AButton :disabled="busy" @click="save({ action: 'mark', index: currentSentence, marked: !lesson.marked.includes(currentSentence) })"><BookmarkCheck :size="16" />{{ lesson.marked.includes(currentSentence) ? '已理解，移出复习' : '还不理解，加入复习' }}</AButton>
        </template>
      </ACard>
      <div v-else-if="lesson.summary.position === 'practice'" class="course-practice">
        <p>挑想练的题目就好，做题不是阅读的前提。</p>
        <ACard v-for="(question, index) in lesson.questions" :key="index" class="course-question" :aria-label="'理解题 ' + (index + 1)">
          <h3>{{ index + 1 }}. {{ question.prompt }}</h3>
          <ARadioGroup v-model:value="choices[index]" :disabled="busy || question.selected !== null && !practicing.includes(index)" :aria-label="'理解题 ' + (index + 1) + ' 选项'"><ARadio v-for="(option, choice) in question.options" :key="choice" :value="choice">{{ option }}</ARadio></ARadioGroup>
          <div v-if="question.selected !== null && !practicing.includes(index)" class="course-feedback">
            <ATag :color="question.selected === question.answer ? 'success' : 'warning'">{{ question.selected === question.answer ? '回答正确' : '再看看这句话' }}</ATag>
            <p>参考答案：{{ question.options[question.answer!] }}</p><p>{{ question.explanation }}</p><blockquote lang="en">{{ question.evidence }}</blockquote>
            <AButton :disabled="busy" @click="again(index)">再练一次</AButton>
          </div>
          <AButton v-else type="primary" :disabled="busy || choices[index] === undefined" @click="save({ action: 'answer', index, choice: choices[index] })">提交第 {{ index + 1 }} 题</AButton>
        </ACard>
        <p v-if="lesson.wrong.length || lesson.marked.length">错题和标记句子会留在“我的积累”。重新答对或标记已理解后移出待复习清单。</p>
      </div>
    </template>
    <ConfirmDialog v-if="confirm" message="将重新读取服务器进度，并放弃本页尚未确认的操作。是否继续？" confirm-label="采用服务器进度" @answer="adopt" />
    <ReadingAddDialog v-if="adding" :username="username" @close="adding = false" @saved="added" />
    <ReadingSourcesDialog v-if="sources" @close="sources = false" @changed="list" />
  </section>
</template>

<style scoped>
.sentence-list{grid-template-columns:repeat(3,minmax(0,1fr))}.sentence-card{min-width:0}.sentence-card :deep(.ant-card-body){display:flex;flex-direction:column;min-height:210px;height:100%;gap:10px;padding:18px}.sentence-card .course-word{align-items:start;flex:1}.sentence-card .course-word p{margin:0}.sentence-card .course-sections{margin-top:auto}.sentence-card small{margin-bottom:0}@media(min-width:1800px){.sentence-list{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:1200px){.sentence-list{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:640px){.sentence-list{grid-template-columns:minmax(0,1fr)}.sentence-card :deep(.ant-card-body){min-height:180px;padding:14px}}
.course-learning{display:flex!important;flex-direction:column;flex:1;min-height:0;overflow:hidden;padding-bottom:0!important}.course-learning>*{flex-shrink:0}.course-list-scroll{flex:1;min-height:0;overflow:auto;padding:2px 8px 8px 2px;scrollbar-gutter:stable}.course-pagination{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:12px 0;border-top:1px solid var(--color-border);font-size:12px}.course-learning>.course-body,.course-learning>.course-practice{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}.course-practice{align-content:start}
.course-learning > h2,.course-learning > p{margin:0}
.course-learning{display:grid;gap:16px;padding-bottom:24px;min-width:0}.course-heading,.course-word{display:flex;justify-content:space-between;align-items:center;gap:12px}.course-heading h2{display:flex;align-items:center;gap:8px;margin:0}.course-heading p,.course-source,.course-card small{color:var(--color-text-muted)}.course-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.course-card h3{margin:12px 0}.course-card small{display:block;line-height:1.6}.course-sections{display:flex;flex-wrap:wrap;gap:8px}.course-body,.course-question{min-width:0;background:var(--color-surface)}.course-body p,.course-feedback p,.course-word h3{line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere}.course-word h3{flex:1;margin:0}.course-sentence details,.course-vocabulary{margin:16px 0;padding:12px;border:1px solid var(--color-border);border-radius:8px}.course-learning summary{cursor:pointer;min-height:32px;display:list-item;align-content:center}.course-vocabulary article{padding:12px 0;border-bottom:1px solid var(--color-border)}.course-practice{display:grid;gap:16px}.course-question :deep(.ant-radio-group){display:grid;gap:10px;margin:12px 0 20px}.course-feedback{border-top:1px solid var(--color-border);padding-top:12px}.course-feedback blockquote{margin:12px 0;padding:12px;border-left:3px solid var(--color-border);background:var(--color-background);overflow-wrap:anywhere}.course-heading>span{font-size:12px;color:var(--color-text-muted)}@media(max-width:700px){.course-list{grid-template-columns:minmax(0,1fr)}.course-heading{flex-wrap:wrap}.course-word{align-items:start}.course-learning :deep(.ant-btn){height:auto;min-height:44px;white-space:normal}.course-learning summary{min-height:44px}.course-question :deep(.ant-radio-wrapper){min-height:44px;align-items:center}.course-body :deep(.ant-card-body),.course-question :deep(.ant-card-body){padding:16px}}
.sentence-list{display:grid;gap:12px}.sentence-card p[lang='en']{font-family:Georgia,serif;font-size:18px;line-height:1.8;margin:0 0 12px;overflow-wrap:anywhere}.sentence-card small{display:block;color:var(--color-text-muted);margin-bottom:14px}.course-heading>div>p{margin-bottom:0}.course-card h3{font-family:Georgia,'Songti SC',serif;font-size:22px;font-weight:500}.course-card .ant-tag{display:inline-flex;align-items:center;gap:4px}
</style>
