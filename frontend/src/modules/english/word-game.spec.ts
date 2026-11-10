import { describe, expect, it } from 'vitest'
import { resolveWordGame } from './word-game'

const legacy = {
  id: 'round', batchId: '1', revision: '0', sourceCount: 1, eligibleCount: 1,
  words: [{ id: 0, label: 'apple' }], meanings: [{ id: 0, label: '苹果' }],
  matched: [], attempts: 0, streak: 0, bestStreak: 0, mistakes: [],
  completed: false, elapsedSeconds: 0, feedback: null,
}

describe('word game response compatibility', () => {
  it('keeps old matching responses visible in the matching round', () => {
    expect(resolveWordGame(legacy, 'matching')).toMatchObject({ mode: 'matching', words: legacy.words })
  })

  it('reports an old backend instead of hiding a spelling round', () => {
    expect(() => resolveWordGame(legacy, 'spelling')).toThrow('后端尚未加载拼写功能')
  })

  it('keeps a current spelling prompt and rejects the wrong mode', () => {
    const current = { ...legacy, mode: 'spelling', completed: false,
      spellingPrompt: { wordId: 0, meaning: '苹果', example: null } } satisfies import('./word-game').WordGame
    expect(resolveWordGame(current, 'spelling')).toBe(current)
    expect(() => resolveWordGame(current, 'matching')).toThrow('版本不一致')
  })
})
