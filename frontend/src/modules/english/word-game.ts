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
  | { kind: 'create'; id: string; body: { batchId: string; mode: WordGameMode; reviewOf?: string } }
  | { kind: 'answer'; id: string; gameId: string; body: { baseRevision: string; wordId: number; meaningId: number } }
  | { kind: 'spelling'; id: string; gameId: string; body: { baseRevision: string; wordId: number; spelling: string } }

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
