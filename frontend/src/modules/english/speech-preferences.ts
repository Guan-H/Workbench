import { readonly, shallowRef } from 'vue'

export const repeatChoices = [1, 2, 3, 5] as const
export const gapChoices = [1, 2, 3, 5] as const
export interface SpeechPreferences { wordRepeats: number; sentenceRepeats: number; gapSeconds: number }
export type SpeechKind = 'word' | 'sentence' | 'article'
const storageKey = 'workbench-english-speech'
const defaults: SpeechPreferences = { wordRepeats: 3, sentenceRepeats: 2, gapSeconds: 2 }

function load(): SpeechPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
    if (saved && repeatChoices.includes(saved.wordRepeats) && repeatChoices.includes(saved.sentenceRepeats) && gapChoices.includes(saved.gapSeconds)) {
      return { wordRepeats: saved.wordRepeats, sentenceRepeats: saved.sentenceRepeats, gapSeconds: saved.gapSeconds }
    }
  } catch { /* Ordinary playback preferences may be unavailable; preserve usable defaults. */ }
  return { ...defaults }
}

const preferences = shallowRef(load())
export const speechPreferences = readonly(preferences)

/** Playback preferences are local device settings, never learning results or backend progress. */
export function setSpeechPreference(key: keyof SpeechPreferences, value: number) {
  const allowed: readonly number[] = key === 'gapSeconds' ? gapChoices : repeatChoices
  if (!allowed.includes(value)) return false
  preferences.value = { ...preferences.value, [key]: value }
  try { localStorage.setItem(storageKey, JSON.stringify(preferences.value)); return true }
  catch { return false }
}

export function speechOptions(kind: SpeechKind) {
  const value = preferences.value
  return { repeats: kind === 'article' ? 1 : kind === 'word' ? value.wordRepeats : value.sentenceRepeats, gapSeconds: value.gapSeconds }
}
