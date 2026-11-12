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
  it('repeats the complete word a finite number of times with a follow-along gap', async () => {
    const speech = await import('./speech')
    speech.toggleEnglishSpeech(Symbol(), 'convenient', { repeats: 3, gapSeconds: 2 })
    await vi.advanceTimersByTimeAsync(1)
    for (let iteration = 1; iteration <= 3; iteration++) {
      expect(speech.englishSpeech.value).toMatchObject({ iteration, total: 3 })
      spoken.at(-1)?.onend?.(); await vi.advanceTimersByTimeAsync(1)
      if (iteration < 3) {
        expect(speech.englishSpeech.value?.phase).toBe('waiting')
        await vi.advanceTimersByTimeAsync(1950)
        expect(spoken).toHaveLength(iteration)
        await vi.advanceTimersByTimeAsync(100)
      }
    }
    expect(spoken.map(item => item.text)).toEqual(['convenient', 'convenient', 'convenient'])
    expect(speech.englishSpeech.value).toBeUndefined()
    await vi.advanceTimersByTimeAsync(5000)
    expect(spoken).toHaveLength(3)
  })
  it('cancels a waiting repeat and ignores callbacks from the completed utterance', async () => {
    const speech = await import('./speech'), owner = Symbol()
    speech.toggleEnglishSpeech(owner, 'comfortable', { repeats: 5, gapSeconds: 1 })
    await vi.advanceTimersByTimeAsync(1)
    const first = spoken[0]!
    first.onend?.(); await vi.advanceTimersByTimeAsync(1)
    first.onend?.(); first.onerror?.({ error: 'interrupted' })
    expect(speech.englishSpeech.value?.phase).toBe('waiting')
    speech.toggleEnglishSpeech(owner, 'comfortable')
    await vi.advanceTimersByTimeAsync(5000)
    expect(spoken).toHaveLength(1)
    expect(speech.englishSpeech.value).toBeUndefined()
    expect(speech.englishSpeechNotice.value).toBeUndefined()
  })
  it('repeats all sentence chunks together and stops the entire loop on a native error', async () => {
    const speech = await import('./speech'), text = 'Small steps make a difference. '.repeat(20).trim()
    const chunks = speech.speechChunks(text)
    speech.toggleEnglishSpeech(Symbol(), text, { repeats: 2, gapSeconds: 1 })
    await vi.advanceTimersByTimeAsync(1)
    for (let index = 0; index < chunks.length; index++) {
      expect(spoken[index]?.text).toBe(chunks[index])
      spoken[index]?.onend?.(); await vi.advanceTimersByTimeAsync(1)
    }
    expect(speech.englishSpeech.value).toMatchObject({ phase: 'waiting', iteration: 1, total: 2 })
    await vi.advanceTimersByTimeAsync(1050)
    expect(spoken.at(-1)?.text).toBe(chunks[0])
    expect(speech.englishSpeech.value?.iteration).toBe(2)
    spoken.at(-1)?.onerror?.({ error: 'network' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(spoken).toHaveLength(chunks.length + 1)
    expect(speech.englishSpeech.value).toBeUndefined()
    expect(speech.englishSpeechNotice.value?.text).toContain('朗读失败')
  })
  it('completes a one-shot awaiter only after the engine finishes the whole word', async () => {
    const speech = await import('./speech')
    const completed = vi.fn()
    const playback = speech.playEnglishSpeech(Symbol(), 'convenient').then(result => { completed(result); return result })
    await vi.advanceTimersByTimeAsync(1)
    expect(completed).not.toHaveBeenCalled()
    spoken[0]?.onstart?.()
    expect(completed).not.toHaveBeenCalled()
    spoken[0]?.onend?.(); await vi.advanceTimersByTimeAsync(1)
    expect(await playback).toBe('finished')
    expect(completed).toHaveBeenCalledExactlyOnceWith('finished')
    await vi.advanceTimersByTimeAsync(5000)
    expect(spoken).toHaveLength(1)
  })
  it('restarts the same card on each click and settles the previous wait as cancelled', async () => {
    const speech = await import('./speech'), owner = Symbol()
    const first = speech.playEnglishSpeech(owner, 'convenient')
    await vi.advanceTimersByTimeAsync(1)
    const second = speech.playEnglishSpeech(owner, 'convenient')
    expect(await first).toBe('cancelled')
    spoken[0]?.onend?.()
    await vi.advanceTimersByTimeAsync(100)
    expect(spoken.map(item => item.text)).toEqual(['convenient', 'convenient'])
    spoken[1]?.onend?.(); await vi.advanceTimersByTimeAsync(1)
    expect(await second).toBe('finished')
  })
  it('distinguishes native failure and user cancellation from a completed pronunciation', async () => {
    const speech = await import('./speech'), owner = Symbol()
    const failed = speech.playEnglishSpeech(owner, 'convenient')
    await vi.advanceTimersByTimeAsync(1)
    spoken[0]?.onerror?.({ error: 'network' })
    expect(await failed).toBe('failed')
    const cancelled = speech.playEnglishSpeech(owner, 'convenient')
    speech.stopEnglishSpeech(owner)
    expect(await cancelled).toBe('cancelled')
    await vi.advanceTimersByTimeAsync(1000)
    expect(spoken).toHaveLength(1)
  })
})
