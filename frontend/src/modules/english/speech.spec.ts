import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class TestUtterance {
  voice?: SpeechSynthesisVoice
  lang = ''
  rate = 1
  onstart?: () => void
  onend?: () => void
  onerror?: (event: { error: string }) => void
  constructor(readonly text: string) {}
}

// Unit-level native API stand-ins only; these assertions do not prove audible output.
describe('native speech scheduling', () => {
  let spoken: TestUtterance[]
  beforeEach(() => {
    vi.resetModules(); vi.useFakeTimers(); spoken = []
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('SpeechSynthesisUtterance', TestUtterance)
    vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'en-US' }], cancel: vi.fn(), speak: (utterance: TestUtterance) => spoken.push(utterance) })
  })
  afterEach(async () => {
    const speech = await import('./speech')
    speech.stopEnglishSpeech(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals()
  })
  it('passes the whole word and spaces cancellation before the replacement', async () => {
    const speech = await import('./speech')
    speech.toggleEnglishSpeech(Symbol(), 'convenient')
    await vi.advanceTimersByTimeAsync(1)
    expect(spoken.map(item => item.text)).toEqual(['convenient'])
    speech.toggleEnglishSpeech(Symbol(), 'comfortable')
    await vi.advanceTimersByTimeAsync(99)
    expect(spoken).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(spoken[1]?.text).toBe('comfortable')
  })
  it('only starts the last rapidly selected word and stopping cancels queued startup', async () => {
    const speech = await import('./speech')
    speech.toggleEnglishSpeech(Symbol(), 'first')
    speech.toggleEnglishSpeech(Symbol(), 'second')
    const owner = Symbol()
    speech.toggleEnglishSpeech(owner, 'convenient')
    await vi.advanceTimersByTimeAsync(100)
    expect(spoken.map(item => item.text)).toEqual(['convenient'])
    speech.toggleEnglishSpeech(Symbol(), 'cancelled-before-start')
    speech.stopEnglishSpeech()
    await vi.advanceTimersByTimeAsync(100)
    expect(spoken).toHaveLength(1)
  })
  it('ignores duplicate or late callbacks from the preceding article chunk', async () => {
    const speech = await import('./speech')
    const text = 'convenient '.repeat(60).trim()
    speech.toggleEnglishSpeech(Symbol(), text)
    await vi.advanceTimersByTimeAsync(1)
    const first = spoken[0]!
    first.onend?.(); await vi.advanceTimersByTimeAsync(1)
    expect(spoken).toHaveLength(2)
    first.onend?.(); first.onerror?.({ error: 'interrupted' })
    await vi.advanceTimersByTimeAsync(1)
    expect(spoken).toHaveLength(2)
    expect(speech.englishSpeech.value).toBeDefined()
    expect(speech.englishSpeechNotice.value).toBeUndefined()
    while (speech.englishSpeech.value) { spoken.at(-1)?.onend?.(); await vi.advanceTimersByTimeAsync(1) }
    expect(spoken.map(item => item.text).join(' ')).toBe(text)
  })
})
