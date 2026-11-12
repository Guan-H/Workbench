import type { Word } from './types'

export interface WordChoice { id: number; label: string }
export type WordGameMode = 'matching' | 'spelling'
interface WordGameBase {
  id: string
  batchId: string
  revision: string
  sourceCount: number
  eligibleCount: number
  words: WordChoice[]
  meanings: WordChoice[]
  matched: number[]
  attempts: number
  streak: number
  bestStreak: number
  mistakes: Word[]
  elapsedSeconds: number
  feedback: { wordId: number; meaningId: number; correct: boolean } | null
}

export type WordGame = WordGameBase & (
  | { mode: 'matching'; completed: boolean; spellingPrompt: null }
  | { mode: 'spelling'; completed: false; spellingPrompt: { wordId: number; meaning: string; example: string | null } }
  | { mode: 'spelling'; completed: true; spellingPrompt: null }
)

/** The running V20 matching backend may predate the spelling response fields. */
export type WordGameResponse = WordGame | (WordGameBase & { completed: boolean })

export class WordGameVersionError extends Error {}

export function resolveWordGame(value: WordGameResponse, expectedMode: WordGameMode): WordGame {
  if (!('mode' in value)) {
    if (expectedMode === 'matching') return { ...value, mode: 'matching', spellingPrompt: null }
    throw new WordGameVersionError('本地后端尚未加载拼写功能，请更新并重启 Workbench 后端。配对模式仍可使用。')
  }
  if (value.mode !== expectedMode || (value.mode === 'spelling' && !value.completed && !value.spellingPrompt)) {
    throw new WordGameVersionError('练习接口与当前页面版本不一致，请更新后端并刷新页面后重试。')
  }
  return value
}

export type WordGameOperation =
  | { kind: 'create'; id: string; body: { batchId: string; mode: WordGameMode; reviewOf?: string; studyPlanId?: string } }
  | { kind: 'answer'; id: string; gameId: string; body: { baseRevision: string; wordId: number; meaningId: number } }
  | { kind: 'spelling'; id: string; gameId: string; body: { baseRevision: string; wordId: number; spelling: string } }

export type WordAnswerOperation = Exclude<WordGameOperation, { kind: 'create' }>

// Match the server's String.strip / equalsIgnoreCase, including simple Unicode casing.
function spellingKey(value: string) {
  const stripped = value.replace(/^[\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+$/gu, '')
  return Array.from(stripped, character => {
    const upper = character.toUpperCase()
    const simple = Array.from(upper).length === 1 ? upper : character
    return simple === '\u0130' ? 'i' : simple.toLowerCase()
  }).join('')
}

/** Immediate feedback from the real round; the server still validates every queued attempt. */
export function projectWordAnswer(game: WordGame, operation: WordAnswerOperation, vocabulary: Word[], elapsedSeconds: number): WordGame {
  const wordId = operation.body.wordId
  const meaningId = operation.kind === 'spelling' ? wordId : operation.body.meaningId
  const target = game.words.find(item => item.id === wordId)
  if (!target || game.completed || game.matched.includes(wordId) || game.matched.includes(meaningId)) throw new Error('练习状态已变化，请核对进度。')
  const correct = operation.kind === 'spelling' ? spellingKey(target.label) === spellingKey(operation.body.spelling) : wordId === meaningId
  const matched = correct ? [...game.matched, wordId] : [...game.matched]
  const mistakes = [...game.mistakes]
  if (!correct) for (const id of new Set([wordId, meaningId])) {
    const word = game.words.find(item => item.id === id)
    const meaning = game.meanings.find(item => item.id === id)
    if (word && meaning && !mistakes.some(item => item.word === word.label && item.meaning === meaning.label)) mistakes.push(vocabulary.find(item => item.word === word.label && item.meaning === meaning.label)
      ?? { word: word.label, meaning: meaning.label, phonetic: null, example: null })
  }
  const streak = correct ? game.streak + 1 : 0
  const common = { ...game, revision: String(BigInt(game.revision) + 1n), matched, mistakes, attempts: game.attempts + 1,
    streak, bestStreak: Math.max(game.bestStreak, streak), elapsedSeconds, feedback: { wordId, meaningId, correct } }
  const completed = matched.length === game.words.length
  if (game.mode === 'matching') return { ...common, mode: 'matching', completed, spellingPrompt: null }
  if (completed) return { ...common, mode: 'spelling', completed: true, spellingPrompt: null }
  const next = game.words.find(item => !matched.includes(item.id))!
  const nextMeaning = game.meanings.find(item => item.id === next.id)!.label
  const source = vocabulary.find(item => item.word === next.label && item.meaning === nextMeaning)
  const escaped = next.label.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return { ...common, mode: 'spelling', completed: false, spellingPrompt: { wordId: next.id,
    meaning: game.meanings.find(item => item.id === next.id)!.label,
    example: source?.example?.replace(new RegExp(escaped, 'giu'), '____') ?? null } }
}

/** getRandomValues also works on the existing LAN HTTP development entry. */
export function wordGameOperationId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 15) | 64
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function practiceTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
