<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Input as AInput, Progress as AProgress, RadioGroup as ARadioGroup, RadioButton as ARadioButton } from 'ant-design-vue'
import { Check, Puzzle, RotateCcw, Trophy, X } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, useId } from 'vue'
import AppDialog from '../../shared/AppDialog.vue'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'
import { practiceTime, wordGameOperationId, type WordGame, type WordGameMode } from './word-game'
import { wordPractice } from './word-practice'
import type { Word } from './types'
import ReadAloudButton from './ReadAloudButton.vue'
import SpeechSettings from './SpeechSettings.vue'
import { playEnglishSpeech, stopEnglishSpeech } from './speech'

const props = defineProps<{ username: string; batchId: string; wordCount: number; vocabulary: Word[]; studyPlanId?: string; matchingGame?: string | null; spellingGame?: string | null }>()
const emit=defineEmits<{ stored: [] }>()
const titleId=useId()
const opened = ref(false), mode = ref<WordGameMode>('matching'), ticking = ref(0), confirmation = ref(false)
const sessions = { matching: wordPractice(props.username, props.batchId, 'matching', props.vocabulary,props.studyPlanId), spelling: wordPractice(props.username, props.batchId, 'spelling', props.vocabulary,props.studyPlanId) }
const practice = computed(() => sessions[mode.value])
type SpellingRound = Extract<WordGame, { mode: 'spelling'; completed: false }>
const readback = ref<{ round: SpellingRound; word: string; phase: 'speaking' | 'interrupted' }>()
const spellingSpeechOwner = Symbol('spelling-correct'), matchingSpeechOwner = Symbol('matching-choice')
let readbackSerial = 0
// The answer is already queued for persistence; keep its prompt on screen until pronunciation ends.
const game = computed(() => readback.value?.round ?? practice.value.game.value)
const busy = computed(() => practice.value.creating.value)
const pending = computed(() => practice.value.queue.value.length > 0 || !!practice.value.createPending.value)
const syncing = computed(() => practice.value.syncing.value)
const error = computed(() => practice.value.error.value)
const requiresReload = computed(() => practice.value.conflict.value)
const blocked = computed(() => busy.value || requiresReload.value || practice.value.storageFailed.value)
const word = ref<number>(), meaning = ref<number>()
const spellingInput = ref(''), hintShown = ref(false), spellingField = ref<{ focus: () => void }>()
let timer: ReturnType<typeof setInterval> | undefined
const elapsed = computed(() => { void ticking.value; return practice.value.elapsed() })
const accuracy = computed(() => game.value?.attempts ? Math.round(game.value.matched.length / game.value.attempts * 100) : 0)
const spellingRound = computed(() => game.value?.mode === 'spelling' && !game.value.completed ? game.value : undefined)
const spellingWord = computed(() => spellingRound.value?.words.find(choice => choice.id === spellingRound.value?.spellingPrompt.wordId)?.label ?? '')
const feedback = computed(() => readback.value
  ? readback.value.phase === 'speaking' ? '拼写正确！朗读一遍后继续。' : '拼写正确，本次朗读未完成，可重听或继续。'
  : game.value?.feedback
  ? mode.value === 'spelling'
    ? game.value.feedback.correct ? '拼写正确！继续下一题。' : '还没有拼对，请修改后再试。'
    : game.value.feedback.correct ? '配对正确！继续寻找下一对。' : '这两个还不是一对，再试一次。'
  : mode.value === 'spelling' ? '根据释义输入英文单词，按回车也可以提交。' : '点击英文单词会朗读一遍，再选对应释义；也可以先选释义。')
function clearReadback() { ++readbackSerial; readback.value = undefined; stopEnglishSpeech(spellingSpeechOwner) }
watch(opened, () => { clearReadback(); stopEnglishSpeech() })
watch(mode, () => { clearReadback(); stopEnglishSpeech(); word.value = undefined; meaning.value = undefined; spellingInput.value = ''; hintShown.value = false })
watch(requiresReload, value => { if (value) stopEnglishSpeech(spellingSpeechOwner) })
function start(reviewOf?: string) {
  if (!blocked.value && !pending.value) void practice.value.start(reviewOf)
}
function open() {
  opened.value = true
  if (pending.value) void practice.value.retry()
  else if (!game.value || game.value.completed) start()
}
function choose(side: 'word' | 'meaning', id: number) {
  const current = game.value
  if (!current || current.completed || blocked.value || current.matched.includes(id)) return
  if (side === 'word') {
    const label = current.words.find(choice => choice.id === id)?.label
    if (label) void playEnglishSpeech(matchingSpeechOwner, label, { repeats: 1, gapSeconds: 2 })
    word.value = word.value === id ? undefined : id
  }
  else meaning.value = meaning.value === id ? undefined : id
  if (word.value !== undefined && meaning.value !== undefined) {
    practice.value.answer({ kind: 'answer', id: wordGameOperationId(), gameId: current.id,
      body: { baseRevision: current.revision, wordId: word.value, meaningId: meaning.value } })
    word.value = undefined; meaning.value = undefined
  }
}
function submitSpelling() {
  const current = spellingRound.value
  if (!current || readback.value || blocked.value || !spellingInput.value.trim()) return
  const answerWord = spellingWord.value
  practice.value.answer({ kind: 'spelling', id: wordGameOperationId(), gameId: current.id,
    body: { baseRevision: current.revision, wordId: current.spellingPrompt.wordId, spelling: spellingInput.value } })
  const updated = practice.value.game.value
  if (updated?.mode === 'spelling' && updated.revision !== current.revision && updated.feedback?.correct) {
    readback.value = { round: { ...updated, completed: false, spellingPrompt: current.spellingPrompt }, word: answerWord, phase: 'speaking' }
    void pronounceCorrectWord()
    return
  }
  void nextTick(() => spellingField.value?.focus())
}
async function pronounceCorrectWord() {
  const value = readback.value
  if (!value || blocked.value) return
  const serial = ++readbackSerial
  value.phase = 'speaking'
  const result = await playEnglishSpeech(spellingSpeechOwner, value.word, { repeats: 1, gapSeconds: 2 })
  if (serial !== readbackSerial || !opened.value || mode.value !== 'spelling') return
  if (result === 'finished' && !requiresReload.value) nextSpelling()
  else value.phase = 'interrupted'
}
function nextSpelling() {
  clearReadback(); spellingInput.value = ''; hintShown.value = false
  void nextTick(() => spellingField.value?.focus())
}
async function adoptServer(accepted: boolean) {
  confirmation.value = false
  if (!accepted) return
  clearReadback()
  try { await practice.value.adoptServer(); word.value = undefined; meaning.value = undefined; spellingInput.value = ''; hintShown.value = false }
  catch (cause) { practice.value.error.value = cause instanceof Error ? cause.message : '读取进度失败，请重试。' }
}
function incorrect(side: 'word' | 'meaning', id: number) {
  const last = game.value?.feedback
  return !!last && !last.correct && word.value === undefined && meaning.value === undefined && (side === 'word' ? last.wordId : last.meaningId) === id
}
watch([syncing,()=>game.value?.revision],()=>{if(!syncing.value&&!pending.value&&game.value)emit('stored')})
onMounted(() => {
  timer = setInterval(() => { ticking.value++ }, 1000)
  if(props.matchingGame)void sessions.matching.resume(props.matchingGame)
  if(props.spellingGame)void sessions.spelling.resume(props.spellingGame)
})
onBeforeUnmount(() => { clearInterval(timer); clearReadback(); stopEnglishSpeech(matchingSpeechOwner) })
</script>

<template>
  <aside class="word-challenge" :aria-labelledby="titleId">
    <span class="word-challenge-icon"><Puzzle :size="21" aria-hidden="true" /></span>
    <div><h3 :id="titleId">单词挑战</h3><p>{{ mode === 'spelling' ? '看释义，练英文拼写。' : '把英文和释义配成一对。' }}</p><small>{{ studyPlanId ? '本计划' : '本批次' }} {{ wordCount }} 个词 · 每轮最多 6 {{ mode === 'spelling' ? '题' : '对' }}</small></div>
    <ARadioGroup v-model:value="mode" size="small" aria-label="单词挑战模式" :disabled="blocked"><ARadioButton value="matching">配对</ARadioButton><ARadioButton value="spelling">拼写</ARadioButton></ARadioGroup>
    <AButton type="primary" :disabled="wordCount === 0 || busy" @click="open">{{ game && !game.completed ? '继续挑战' : '开始挑战' }}</AButton>
  </aside>

  <AppDialog v-if="opened" label="单词挑战" :width="640" class="word-game-modal">
    <section class="word-game-dialog" aria-labelledby="word-game-title" :aria-busy="busy">
      <header class="word-game-header"><div><span>{{ mode === 'spelling' ? '单词拼写' : '单词配对' }}</span><h2 id="word-game-title">{{ game?.completed ? '这一轮，完成了' : mode === 'spelling' ? '把记住的单词写下来' : '找到属于它的另一半' }}</h2></div><AButton type="text" aria-label="关闭单词挑战" :disabled="busy" @click="opened = false"><X :size="20" /></AButton></header>
      <div class="word-game-body">
        <SpeechSettings />
        <p class="word-game-note">配对点击英文单词、拼写答对后的发音均为一遍。</p>
        <AAlert v-if="error" type="error" show-icon :message="error" class="word-game-error">
          <template #description><span v-if="requiresReload">本机待同步答题已保留，采用服务器进度前需要明确确认。</span><span v-else-if="pending">答题结果尚未保存，可继续练习；重试会核对同一操作，不重复计分。</span></template>
          <template #action><AButton v-if="requiresReload" @click="confirmation = true">采用服务器进度</AButton><AButton v-else-if="pending || practice.storageFailed.value" :loading="syncing || busy" @click="practice.retry()">重试上次操作</AButton><AButton v-else :disabled="busy" @click="start()">重新开始</AButton></template>
        </AAlert>
        <template v-if="game">
          <div class="word-game-stats" aria-label="本轮练习统计"><span>{{ mode === 'spelling' ? '已完成' : '已配对' }} <strong>{{ game.matched.length }} / {{ game.words.length }}</strong></span><span>连续答对 <strong>{{ game.streak }}</strong></span><span>用时 <strong>{{ practiceTime(elapsed) }}</strong></span></div>
          <AProgress :percent="Math.round(game.matched.length / game.words.length * 100)" :show-info="false" :stroke-color="'var(--color-primary)'" size="small" />
          <template v-if="!game.completed">
            <p class="word-game-feedback" :class="{ incorrect: game.feedback && !game.feedback.correct }" role="status" aria-live="polite">{{ feedback }}</p>
            <div v-if="game.mode === 'matching'" class="word-game-board" aria-label="英文与释义配对区">
              <div class="word-game-column"><h3>英文单词</h3><div v-for="choice in game.words" :key="choice.id" class="word-game-word" :class="{ matched: game.matched.includes(choice.id) }" :aria-hidden="game.matched.includes(choice.id) || undefined"><AButton class="word-game-choice" :class="{ selected: word === choice.id, incorrect: incorrect('word', choice.id) }" :data-word-choice="choice.id" :aria-pressed="word === choice.id" :disabled="blocked || game.matched.includes(choice.id)" @click="choose('word', choice.id)"><span lang="en">{{ choice.label }}</span><Check v-if="word === choice.id" :size="16" aria-hidden="true" /></AButton><ReadAloudButton v-if="!game.matched.includes(choice.id)" kind="word" once :text="choice.label" :label="`朗读挑战单词 ${choice.label}`" compact :disabled="blocked" /></div></div>
              <div class="word-game-column"><h3>中文释义</h3><AButton v-for="choice in game.meanings" :key="choice.id" class="word-game-choice" :class="{ selected: meaning === choice.id, matched: game.matched.includes(choice.id), incorrect: incorrect('meaning', choice.id) }" :data-meaning-choice="choice.id" :aria-pressed="meaning === choice.id" :aria-hidden="game.matched.includes(choice.id) || undefined" :disabled="blocked || game.matched.includes(choice.id)" @click="choose('meaning', choice.id)"><span>{{ choice.label }}</span><Check v-if="meaning === choice.id" :size="16" aria-hidden="true" /></AButton></div>
            </div>
            <div v-else-if="spellingRound" class="word-spelling" aria-label="英文拼写练习">
              <div class="word-spelling-prompt"><span>中文释义</span><h3>{{ spellingRound.spellingPrompt.meaning }}</h3><p v-if="spellingRound.spellingPrompt.example" lang="en">{{ spellingRound.spellingPrompt.example }}</p></div>
              <form @submit.prevent="submitSpelling"><label for="word-spelling-input">英文拼写</label><AInput id="word-spelling-input" ref="spellingField" v-model:value="spellingInput" size="large" placeholder="输入对应的英文单词" autocomplete="off" autocapitalize="off" autocorrect="off" :spellcheck="false" :maxlength="100" :disabled="blocked || !!readback" /><div class="word-spelling-hints"><AButton :disabled="blocked || !!readback" @click="hintShown = true">首字母提示</AButton><ReadAloudButton kind="word" :text="spellingWord" label="听当前单词发音" :disabled="blocked || !!readback" /></div><p v-if="hintShown" class="word-spelling-hint" role="status">首字母：<strong lang="en">{{ Array.from(spellingWord.trim())[0] }}</strong> · 共 {{ Array.from(spellingWord.trim()).length }} 个字符</p><AButton type="primary" html-type="submit" :disabled="blocked || !!readback || !spellingInput.trim()" >提交拼写</AButton></form>
              <div v-if="readback" class="word-spelling-readback" aria-label="正确单词跟读"><strong lang="en">{{ readback.word }}</strong><p role="status">{{ readback.phase === 'speaking' ? '正在朗读，读完自动继续…' : '本次朗读未完成。可以重听，或直接继续练习。' }}</p><div v-if="readback.phase === 'interrupted'"><AButton :disabled="blocked" @click="pronounceCorrectWord">重听一遍</AButton><AButton type="primary" :disabled="blocked" @click="nextSpelling">{{ practice.game.value?.completed ? '查看本轮结果' : '继续下一题' }}</AButton></div><AButton v-else @click="stopEnglishSpeech(spellingSpeechOwner)">停止朗读</AButton></div>
            </div>
            <p class="word-game-note">不计时限，按自己的节奏来。{{ game.eligibleCount < game.sourceCount ? '重复单词或相同释义已合并出题。' : '' }}</p>
          </template>
          <div v-else class="word-game-result" aria-label="单词挑战结果">
            <span class="word-game-trophy"><Trophy :size="32" aria-hidden="true" /></span><h3>{{ game.mistakes.length ? '再看一眼，这些词会更熟悉' : mode === 'spelling' ? '全部拼写正确' : '全部配对成功' }}</h3>
            <p>{{ game.attempts }} 次{{ mode === 'spelling' ? '提交' : '配对' }} · 正确率 {{ accuracy }}% · 最长连对 {{ game.bestStreak }}</p>
            <div v-if="game.mistakes.length" class="word-game-review" aria-label="本轮错词"><article v-for="item in game.mistakes" :key="item.word"><div><strong lang="en">{{ item.word }}</strong><span v-if="item.phonetic">{{ item.phonetic }}</span><ReadAloudButton kind="word" :text="item.word" :label="`朗读错词 ${item.word}`" compact /></div><p>{{ item.meaning }}</p><div v-if="item.example" class="word-review-example"><p lang="en">{{ item.example }}</p><ReadAloudButton :text="item.example" :label="`朗读错词例句 ${item.word}`" compact /></div></article></div>
            <div class="word-game-result-actions"><AButton v-if="game.mistakes.length" type="primary" :disabled="blocked || pending" @click="start(game.id)"><RotateCcw :size="15" />再练错词（{{ game.mistakes.length }}）</AButton><AButton :disabled="blocked || pending" @click="start()">再来一轮</AButton></div>
          </div>
        </template>
        <p v-else-if="busy" class="word-game-loading" role="status">正在从当前批次准备单词…</p>
        <div v-else-if="!error" class="word-game-loading" role="status"><p>练习尚未就绪，请重新开始。</p><AButton @click="start()">重新开始</AButton></div>
      </div>
      <footer class="word-game-footer"><span role="status">{{ pending ? `待同步 ${practice.queue.value.length} 次答题${syncing ? " · 正在保存" : " · 尚未保存服务器"}` : game ? "本轮答题已同步" : "单词来自当前选中的推送批次" }}</span><AButton :disabled="busy" @click="opened = false">{{ game?.completed ? '完成' : '暂时关闭' }}</AButton></footer>
    </section>
  </AppDialog>
  <ConfirmDialog v-if="confirmation" message="采用服务器当前进度，并放弃本机尚未确认的答题？已在服务器保存的答题不会撤销。" confirm-label="采用服务器进度" @answer="adoptServer" />
</template>

<style scoped>
.word-spelling-readback{padding:16px;margin-top:16px;background:var(--color-selection);border-radius:6px}.word-spelling-readback>strong{font-size:22px;overflow-wrap:anywhere}.word-spelling-readback p{font-size:13px;line-height:1.7}.word-spelling-readback>div{display:flex;flex-wrap:wrap;gap:8px}
.word-challenge { display: flex; flex-direction: column; align-items: start; gap: 12px; padding: 16px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-selection); }
.word-challenge-icon { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 8px; color: var(--color-primary); background: var(--color-surface); }
.word-challenge h3 { margin: 0; font-size: 15px; }.word-challenge p { font-size: 12px; margin: 6px 0; line-height: 1.7; }.word-challenge small { font-size: 11px; color: var(--color-text-muted); line-height: 1.7; }.word-challenge > button { min-height: 40px; }
.word-game-dialog { color: var(--color-text); display: flex; flex-direction: column; max-height: calc(100dvh - 80px); }
.word-game-header { display: flex; align-items: start; justify-content: space-between; gap: 12px; padding: 24px 28px 18px; border-bottom: 1px solid var(--color-border); }.word-game-header > div > span { font-size: 12px; color: var(--color-primary); }.word-game-header h2 { margin: 8px 0 0; font-size: 23px; font-weight: 600; line-height: 1.5; }.word-game-header > button { min-width: 40px; min-height: 40px; }
.word-game-body { padding: 20px 28px; min-height: 0; overflow: auto; }.word-game-error { margin-bottom: 16px; }.word-game-stats { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; font-size: 12px; color: var(--color-text-muted); }.word-game-stats strong { margin-left: 6px; color: var(--color-text); font-weight: 600; }.word-game-feedback { margin: 12px 0 16px; font-size: 13px; color: var(--color-primary); line-height: 1.8; }.word-game-feedback.incorrect { color: var(--color-danger); }
.word-game-board { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }.word-game-column { display: flex; flex-direction: column; gap: 10px; min-width: 0; }.word-game-column h3 { margin: 0 0 2px; color: var(--color-text-muted); font-size: 12px; font-weight: 400; }
.word-game-choice.ant-btn { min-height: 60px; height: 60px; padding: 10px 14px; width: 100%; white-space: normal; text-align: left; justify-content: space-between; border-color: var(--color-border); transition: opacity .18s, background-color .18s, border-color .18s; }.word-game-choice > span { display: block; max-height: 100%; overflow: auto; overflow-wrap: anywhere; line-height: 1.6; }.word-game-choice [lang=en] { font-size: 17px; font-weight: 500; }.word-game-choice.ant-btn.selected { border: 2px solid var(--color-primary); background: var(--color-selection); color: var(--color-primary-hover); }.word-game-choice.ant-btn.incorrect { border-color: var(--color-danger); background: #fff2f0; }.word-game-choice.matched { opacity: 0; pointer-events: none; visibility: hidden; }.word-game-choice:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.word-game-note { margin: 16px 0 0; font-size: 12px; color: var(--color-text-muted); line-height: 1.8; }.word-game-footer { border-top: 1px solid var(--color-border); padding: 16px 28px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }.word-game-footer span { font-size: 12px; color: var(--color-text-muted); }.word-game-footer button { min-height: 40px; }.word-game-loading { padding: 30px 0; text-align: center; color: var(--color-text-muted); }
.word-game-result { padding-top: 20px; text-align: center; }.word-game-trophy { display: inline-grid; place-items: center; height: 64px; width: 64px; background: var(--color-selection); border-radius: 50%; color: var(--color-primary); }.word-game-result > h3 { margin: 16px 0 8px; font-size: 20px; }.word-game-result > p { color: var(--color-text-muted); font-size: 13px; line-height: 1.8; }.word-game-review { margin-top: 20px; max-height: 260px; overflow: auto; text-align: left; border-block: 1px solid var(--color-border); }.word-game-review article { padding: 14px 0; }.word-game-review article + article { border-top: 1px solid var(--color-border); }.word-game-review article > div { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }.word-game-review strong { font-size: 17px; }.word-game-review span { color: var(--color-text-muted); font-size: 12px; }.word-game-review p { margin: 6px 0 0; font-size: 13px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }.word-game-result-actions { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; margin-top: 22px; }.word-game-result-actions button { min-height: 44px; }
@media (max-width: 600px) { .word-challenge { flex-direction: row; align-items: center; flex-wrap: wrap; gap: 10px; }.word-challenge > div { flex: 1; min-width: 140px; }.word-game-dialog { height: 100dvh; max-height: 100dvh; }.word-game-body { flex: 1; padding: 16px; }.word-game-header { padding: 20px 16px 16px; }.word-game-header h2 { font-size: 20px; }.word-game-board { gap: 10px; }.word-game-choice.ant-btn { min-height: 64px; height: 64px; padding: 8px 10px; }.word-game-choice [lang=en] { font-size: 15px; }.word-game-footer { padding: 12px 16px max(12px, env(safe-area-inset-bottom)); }.word-game-footer span { max-width: 65%; line-height: 1.7; }.word-game-review { max-height: none; } }
@media (prefers-reduced-motion: reduce) { .word-game-choice.ant-btn { transition: none; } }
</style>

<style scoped>
.word-game-header { padding: 18px 20px 14px; }
.word-game-header h2 { font-size: 20px; }
.word-game-body { padding: 14px 20px; }
.word-game-column { gap: 8px; }
.word-game-choice.ant-btn { height: 48px; min-height: 48px; padding: 8px 12px; }
.word-game-choice [lang=en] { font-size: 16px; }
.word-game-word { display: flex; align-items: stretch; gap: 6px; min-width: 0; }
.word-game-word > .word-game-choice { flex: 1; min-width: 0; }
.word-game-word :deep(.speech-button) { width: 32px; min-height: 48px; }
.word-game-word.matched { visibility: hidden; pointer-events: none; }
.word-game-footer { padding: 12px 20px; }
.word-game-review .word-review-example { display: flex; align-items: start; flex-wrap: nowrap; gap: 8px; }
.word-review-example p { min-width: 0; flex: 1; }
.word-spelling-prompt { padding: 18px; background: var(--color-selection); border-radius: 8px; overflow-wrap: anywhere; }
.word-spelling-prompt > span { font-size: 12px; color: var(--color-text-muted); }
.word-spelling-prompt h3 { margin: 10px 0; font-size: 21px; line-height: 1.6; }
.word-spelling-prompt p { margin: 10px 0 0; font-size: 14px; line-height: 1.8; white-space: pre-wrap; }
.word-spelling form { display: grid; gap: 12px; margin-top: 20px; }
.word-spelling label { font-size: 13px; }
.word-spelling form > .ant-btn { min-height: 44px; }
.word-spelling-hints { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.word-spelling-hint { margin: 0; color: var(--color-primary); font-size: 13px; }
.word-spelling-hint strong { font-size: 20px; }
@media (max-width: 600px) {
  .word-game-header { padding: 20px 16px 16px; }
  .word-game-body { padding: 16px; }
  .word-game-choice.ant-btn { min-height: 64px; height: 64px; padding: 8px 10px; }
  .word-game-word :deep(.speech-button) { width: 44px; }
  .word-game-footer { padding: 12px 16px max(12px, env(safe-area-inset-bottom)); }
}
</style>

<style>
@media (max-width: 600px) {
  .word-game-modal.ant-modal { top: 0; padding: 0; margin: 0; width: 100% !important; max-width: 100%; }
  .word-game-modal.ant-modal .ant-modal-content { padding: 0; border-radius: 0; }
}
</style>
