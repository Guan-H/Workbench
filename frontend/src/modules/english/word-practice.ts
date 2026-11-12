import { ref, shallowRef } from 'vue'
import { api, ApiError, write } from '../../shared/api/client'
import { sessionGeneration } from '../../shared/api/session'
import { projectWordAnswer, resolveWordGame, wordGameOperationId, type WordAnswerOperation, type WordGame, type WordGameMode, type WordGameOperation, type WordGameResponse } from './word-game'
import type { Word } from './types'

type CreateOperation = Extract<WordGameOperation, { kind: 'create' }>
interface QueuedAnswer { operation: WordAnswerOperation; expected: WordGame }
const practices = new Map<string, WordPractice>()

/** Keep one ordered sender per round across component changes; pending work also survives tab reload. */
export class WordPractice {
  readonly game = shallowRef<WordGame>()
  readonly queue = shallowRef<QueuedAnswer[]>([])
  readonly creating = ref(false)
  readonly syncing = ref(false)
  readonly error = ref('')
  readonly conflict = ref(false)
  readonly storageFailed = ref(false)
  readonly createPending = shallowRef<CreateOperation>()
  private confirmed?: WordGame
  private receivedAt = performance.now()
  private readonly generation = sessionGeneration()
  private readonly storageKey: string

  constructor(owner: string, readonly batchId: string, readonly mode: WordGameMode, private readonly vocabulary: Word[], private readonly planId?: string) {
    this.storageKey = `workbench-word-practice:${encodeURIComponent(owner)}:${batchId}:${mode}${planId ? ':study:'+planId : ''}`
    try {
      const stored = JSON.parse(sessionStorage.getItem(this.storageKey) || 'null')
      if (!stored) return
      if (stored.version !== 1 || (stored.confirmed && (stored.confirmed.batchId !== batchId || stored.confirmed.mode !== mode)) || !Array.isArray(stored.queue)) throw new Error('Invalid practice queue')
      this.confirmed = stored.confirmed
      this.queue.value = stored.queue
      this.createPending.value = stored.createPending
      this.game.value = this.queue.value.at(-1)?.expected ?? this.confirmed
      this.error.value = '本机有待同步答题，重试将核对原操作，不重复计分。'
    } catch { this.storageFailed.value = true; this.error.value = '无法读取本机待同步答题，请保留浏览器数据并重试。' }
  }

  private active() { return sessionGeneration() === this.generation }
  elapsed() { return (this.game.value?.elapsedSeconds ?? 0) + (this.game.value?.completed ? 0 : Math.floor((performance.now() - this.receivedAt) / 1000)) }

  private persist() {
    try {
      if (!this.queue.value.length && !this.createPending.value) sessionStorage.removeItem(this.storageKey)
      else sessionStorage.setItem(this.storageKey, JSON.stringify({ version: 1, confirmed: this.confirmed, queue: this.queue.value, createPending: this.createPending.value }))
      this.storageFailed.value = false
      return true
    } catch { this.storageFailed.value = true; this.error.value = '本机答题暂存失败，请重试；尚未同步的成绩不能视为已保存。'; return false }
  }

  async start(reviewOf?: string) {
    if (!this.active() || this.creating.value || this.queue.value.length || this.createPending.value) return
    this.createPending.value = { kind: 'create', id: wordGameOperationId(), body: { batchId: this.batchId, mode: this.mode, ...(this.planId ? {studyPlanId:this.planId} : {}), ...(reviewOf ? { reviewOf } : {}) } }
    if (this.persist()) await this.retry()
  }

  answer(operation: WordAnswerOperation) {
    if (!this.active() || !this.game.value || this.conflict.value || this.storageFailed.value) return
    const previous = this.game.value
    const expected = projectWordAnswer(previous, operation, this.vocabulary, this.elapsed())
    this.queue.value = [...this.queue.value, { operation, expected }]
    // Persist the exact operation before showing its result or sending it.
    if (!this.persist()) { this.queue.value = this.queue.value.slice(0, -1); return }
    this.game.value = expected
    this.receivedAt = performance.now()
    void this.retry()
  }

  async retry() {
    if (!this.active() || this.syncing.value || this.creating.value || this.conflict.value) return
    if (!this.persist()) return
    this.error.value = ''
    if (this.createPending.value) {
      this.creating.value = true
      try {
        const operation = this.createPending.value
        const response = await write<WordGameResponse>('/home/english/word-games', 'POST', operation.body, operation.id, AbortSignal.timeout(15000))
        if (!this.active()) return
        this.confirmed = resolveWordGame(response, this.mode)
        this.game.value = this.confirmed
        this.receivedAt = performance.now()
        this.createPending.value = undefined
        this.persist()
      } catch (cause) {
        if (!this.active()) return
        if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) this.createPending.value = undefined
        this.error.value = cause instanceof Error ? cause.message : '准备练习失败，请重试核对。'
        this.persist()
        return
      } finally { this.creating.value = false }
    }
    this.syncing.value = true
    try {
      while (this.queue.value.length && this.active()) {
        const head = this.queue.value[0]!
        const operation = head.operation
        const response = await write<WordGameResponse>(`/home/english/word-games/${operation.gameId}/answers`, 'POST', operation.body, operation.id, AbortSignal.timeout(15000))
        if (!this.active()) return
        const saved = resolveWordGame(response, this.mode)
        // A grading/version difference must not silently replay later locally graded answers.
        if (saved.id !== operation.gameId || saved.revision !== head.expected.revision || saved.attempts !== head.expected.attempts
          || JSON.stringify(saved.matched) !== JSON.stringify(head.expected.matched) || saved.feedback?.correct !== head.expected.feedback?.correct) {
          this.conflict.value = true
          this.error.value = '服务器进度或判定已变化，本机未确认答题已保留，请核对后采用服务器进度。'
          break
        }
        this.confirmed = saved
        this.queue.value = this.queue.value.slice(1)
        if (!this.queue.value.length) { this.game.value = saved; this.receivedAt = performance.now() }
        if (!this.persist()) break
      }
    } catch (cause) {
      if (!this.active()) return
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) this.conflict.value = true
      this.error.value = cause instanceof Error ? cause.message : '答题尚未同步，可以继续练习，稍后重试。'
    } finally { this.syncing.value = false }
  }

  async adoptServer() {
    if (!this.active() || !this.game.value || this.syncing.value) return
    const saved = resolveWordGame(await api<WordGameResponse>(`/home/english/word-games/${this.game.value.id}`, { signal: AbortSignal.timeout(15000) }), this.mode)
    if (!this.active()) return
    this.confirmed = saved; this.game.value = saved; this.queue.value = []; this.createPending.value = undefined
    this.conflict.value = false; this.error.value = ''; this.receivedAt = performance.now(); this.persist()
  }
  async resume(id: string) {
    if(this.game.value || this.queue.value.length || this.createPending.value || this.creating.value) return
    this.creating.value=true
    try {
      const saved=resolveWordGame(await api<WordGameResponse>(`/home/english/word-games/${id}`),this.mode)
      if(!this.active()) return
      this.confirmed=saved;this.game.value=saved;this.receivedAt=performance.now()
    } catch(cause) { this.error.value=cause instanceof Error?cause.message:'读取练习失败。' }
    finally { this.creating.value=false }
  }
}

export function wordPractice(owner: string, batchId: string, mode: WordGameMode, vocabulary: Word[], planId?: string) {
  const prefix = `${sessionGeneration()}:`
  for (const key of practices.keys()) if (!key.startsWith(prefix)) practices.delete(key)
  const key = `${prefix}${owner}:${batchId}:${mode}:${planId ?? ''}`
  let value = practices.get(key)
  // Preserve cross-view work only while it awaits acknowledgement; normal rounds remain page-local.
  if (value && !value.queue.value.length && !value.createPending.value) value = undefined
  if (!value) { value = new WordPractice(owner, batchId, mode, vocabulary, planId); practices.set(key, value) }
  return value
}

window.addEventListener('online', () => { for (const practice of practices.values()) void practice.retry() })
