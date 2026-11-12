import { readonly, shallowRef } from 'vue'
import type { Notice } from '../../shared/AppMessage.vue'
import { prepareSpeechOutput, releaseSpeechOutput } from './speech-output'

interface SpeechJob {
  owner: symbol
  voice: SpeechSynthesisVoice
  chunks: string[]
  index: number
  utterance?: SpeechSynthesisUtterance
}

const active = shallowRef<{ owner: symbol; phase: 'starting' | 'speaking' }>()
const notice = shallowRef<Notice>()
export const englishSpeech = readonly(active)
export const englishSpeechNotice = readonly(notice)
let job: SpeechJob | undefined
let watchdog: ReturnType<typeof setTimeout> | undefined
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let dispatchTimer: ReturnType<typeof setTimeout> | undefined
let cancelledAt = -Infinity

function synthesis() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
    ? window.speechSynthesis : undefined
}

export function prepareEnglishSpeech() { synthesis()?.getVoices() }

export function clearEnglishSpeechNotice() {
  clearTimeout(noticeTimer)
  notice.value = undefined
}

function notify(text: string) {
  clearEnglishSpeechNotice()
  notice.value = { kind: 'error', text }
  noticeTimer = setTimeout(clearEnglishSpeechNotice, 6000)
}

export function stopEnglishSpeech(owner?: symbol) {
  if (!job || (owner !== undefined && job.owner !== owner)) return
  // Clear ownership before cancel: late native events must not stop a newer playback.
  job = undefined
  active.value = undefined
  clearTimeout(watchdog)
  clearTimeout(dispatchTimer)
  cancelledAt = performance.now()
  synthesis()?.cancel()
  releaseSpeechOutput()
}

/** Small chunks avoid native engines rejecting an entire long article. No text is truncated. */
export function speechChunks(text: string) {
  const chunks: string[] = []
  let buffer = ''
  for (const token of text.trim().split(/\s+/u)) {
    if (!token) continue
    const parts = Array.from(token)
    if (parts.length > 220) {
      if (buffer) { chunks.push(buffer); buffer = '' }
      for (let offset = 0; offset < parts.length; offset += 220) chunks.push(parts.slice(offset, offset + 220).join(''))
    } else if (Array.from(buffer).length + parts.length + 1 > 220) {
      chunks.push(buffer)
      buffer = token
    } else buffer += (buffer ? ' ' : '') + token
  }
  if (buffer) chunks.push(buffer)
  return chunks
}

function fail(current: SpeechJob, text: string) {
  if (job !== current) return
  stopEnglishSpeech()
  notify(text)
}

function speakChunk(current: SpeechJob) {
  const engine = synthesis(), text = current.chunks[current.index]
  if (!engine || job !== current) return
  if (text === undefined) {
    clearTimeout(watchdog)
    job = undefined
    active.value = undefined
    releaseSpeechOutput()
    return
  }
  const utterance = new SpeechSynthesisUtterance(text)
  current.utterance = utterance
  utterance.voice = current.voice
  utterance.lang = current.voice.lang
  utterance.rate = 0.9
  active.value = { owner: current.owner, phase: 'starting' }
  utterance.onstart = () => {
    if (job !== current || current.utterance !== utterance) return
    clearTimeout(watchdog)
    active.value = { owner: current.owner, phase: 'speaking' }
    watchdog = setTimeout(() => fail(current, '朗读未能正常结束，请检查设备语音服务后重试。'), Math.max(20000, text.length * 300))
  }
  utterance.onend = () => {
    if (job !== current || current.utterance !== utterance) return
    clearTimeout(watchdog)
    current.utterance = undefined
    current.index++
    dispatchTimer = setTimeout(() => speakChunk(current), 0)
  }
  utterance.onerror = event => {
    if (job !== current || current.utterance !== utterance) return
    if (event.error === 'not-allowed') fail(current, '浏览器未允许播放，请直接点击朗读按钮重试，并检查声音权限。')
    else fail(current, '英文朗读失败，请检查设备语音服务与网络后重试。')
  }
  watchdog = setTimeout(() => fail(current, '语音服务没有开始播放，请检查设备英文语音与声音设置后重试。'), 8000)
  try { engine.speak(utterance) }
  catch { fail(current, '当前浏览器无法启动英文朗读，请检查设备语音设置。') }
}

/** Start preparation in the click; only the latest owner may enqueue native speech afterwards. */
export function toggleEnglishSpeech(owner: symbol, text: string) {
  if (job?.owner === owner) { stopEnglishSpeech(owner); return }
  stopEnglishSpeech()
  clearEnglishSpeechNotice()
  const engine = synthesis()
  if (!engine) { notify('当前浏览器不支持语音朗读，请使用支持语音朗读的浏览器。'); return }
  const voices = engine.getVoices()
  const voice = voices.find(item => item.lang.replace('_', '-').toLowerCase() === 'en-us')
    ?? voices.find(item => /^en(?:[-_]|$)/i.test(item.lang))
  if (!voice) {
    notify(voices.length ? '当前设备没有可用英文语音，请在系统中安装或启用英语语音后重试。' : '语音列表尚未就绪，请稍后重试；若持续不可用，请检查系统语音设置。')
    return
  }
  const chunks = speechChunks(text)
  if (!chunks.length) { notify('没有可朗读的英文内容。'); return }
  const next = { owner, voice, chunks, index: 0 }
  job = next
  active.value = { owner, phase: 'starting' }
  void prepareSpeechOutput().then(() => {
    if (job !== next) return
    // Native cancel is asynchronous on some engines; do not enqueue a replacement in the same turn.
    dispatchTimer = setTimeout(() => speakChunk(next), Math.max(0, 100 - (performance.now() - cancelledAt)))
  })
}

window.addEventListener('pagehide', () => stopEnglishSpeech())
