import { readonly, shallowRef, watchEffect } from 'vue'

export const surfaceModes = ['paper', 'soft'] as const
export type SurfaceMode = typeof surfaceModes[number]
export type AppearanceArea = 'notes' | 'mindmap'
export interface AppearancePreferences { notes: SurfaceMode; mindmap: SurfaceMode }

const storageKey = 'workbench-appearance-v1'
const defaults: AppearancePreferences = { notes: 'paper', mindmap: 'paper' }

function isMode(value: unknown): value is SurfaceMode {
  return typeof value === 'string' && surfaceModes.includes(value as SurfaceMode)
}

function load(): AppearancePreferences {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || 'null')
    if (saved && typeof saved === 'object') {
      const value = saved as Partial<AppearancePreferences>
      if (isMode(value.notes) && isMode(value.mindmap)) return { notes: value.notes, mindmap: value.mindmap }
    }
  } catch { /* Appearance is a local preference; preserve readable defaults when storage is unavailable. */ }
  return { ...defaults }
}

const preferences = shallowRef(load())
export const appearancePreferences = readonly(preferences)
function readTransparency(): Record<AppearanceArea, number> {
  try {
    const value = JSON.parse(localStorage.getItem('workbench-transparency-v1') || '{}')
    return { notes: valid(value.notes, 21), mindmap: valid(value.mindmap, 55) }
  } catch { return { notes: 21, mindmap: 55 } }
}
function valid(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(80, Math.round(value))) : fallback
}
const transparency = shallowRef(readTransparency())
export const surfaceTransparency = readonly(transparency)
export function setSurfaceTransparency(area: AppearanceArea, value: unknown) {
  transparency.value = { ...transparency.value, [area]: valid(value, transparency.value[area]) }
  try {
    localStorage.setItem('workbench-transparency-v1', JSON.stringify(transparency.value))
    return true
  } catch { return false }
}
watchEffect(() => {
  for (const area of ['notes', 'mindmap'] as const) {
    document.documentElement.style.setProperty('--' + area + '-surface-alpha', String(1 - transparency.value[area] / 100))
  }
})

/** Appearance is intentionally local to this browser and never changes document data. */
export function setAppearancePreference(area: AppearanceArea, mode: unknown) {
  if (!isMode(mode)) return false
  preferences.value = { ...preferences.value, [area]: mode }
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences.value))
    return true
  } catch { return false }
}
