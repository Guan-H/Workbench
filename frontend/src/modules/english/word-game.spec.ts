import { describe, expect, it } from 'vitest'
import { projectWordAnswer, resolveWordGame, type WordGame } from './word-game'

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

describe('immediate practice grading', () => {
  const vocabulary = [{ word: 'apple', meaning: '苹果', phonetic: null, example: 'An apple.' }, { word: 'learn', meaning: '学习', phonetic: null, example: 'We LEARN every day.' }]
  const round: WordGame = { ...legacy, mode: 'matching', spellingPrompt: null,
    words: [{ id: 1, label: 'learn' }, { id: 0, label: 'apple' }], meanings: [{ id: 0, label: '苹果' }, { id: 1, label: '学习' }] }
  it('grades by stable IDs rather than shuffled positions and keeps both wrong words', () => {
    const next = projectWordAnswer(round, { kind: 'answer', id: 'op', gameId: round.id, body: { baseRevision: '0', wordId: 1, meaningId: 0 } }, vocabulary, 3)
    expect(next.feedback?.correct).toBe(false)
    expect(next.mistakes.map(item => item.word)).toEqual(['learn', 'apple'])
    expect(next).toMatchObject({ revision: '1', attempts: 1, matched: [], elapsedSeconds: 3 })
    expect(round.attempts).toBe(0)
  })
  it('advances spelling in server word order, masks examples and handles case/whitespace', () => {
    const spelling: WordGame = { ...round, mode: 'spelling', completed: false, spellingPrompt: { wordId: 1, meaning: '学习', example: 'We ____ every day.' } }
    const next = projectWordAnswer(spelling, { kind: 'spelling', id: 'op', gameId: round.id, body: { baseRevision: '0', wordId: 1, spelling: '\u3000LEARN\u3000' } }, vocabulary, 5)
    expect(next).toMatchObject({ matched: [1], streak: 1, spellingPrompt: { wordId: 0, meaning: '苹果', example: 'An ____.' } })
    const done = projectWordAnswer(next, { kind: 'spelling', id: 'op2', gameId: round.id, body: { baseRevision: '1', wordId: 0, spelling: 'APPLE' } }, vocabulary, 6)
    expect(done).toMatchObject({ completed: true, spellingPrompt: null, attempts: 2, bestStreak: 2, revision: '2' })
  })
  it('rejects answering a locally completed card twice', () => {
    const next = projectWordAnswer(round, { kind: 'answer', id: 'op', gameId: round.id, body: { baseRevision: '0', wordId: 0, meaningId: 0 } }, vocabulary, 1)
    expect(() => projectWordAnswer(next, { kind: 'answer', id: 'op2', gameId: round.id, body: { baseRevision: '1', wordId: 0, meaningId: 0 } }, vocabulary, 2)).toThrow('练习状态已变化')
  })
})
