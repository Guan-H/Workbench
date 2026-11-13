import { ref } from 'vue'
import { api } from '../../shared/api/client'
import { setAppearancePreference, setSurfaceTransparency } from './appearance-preferences'

export interface ThemeSettings {
  desktop: string | null; mobile: string | null
  desktopX: number; desktopY: number; mobileX: number; mobileY: number
  overlay: number; accent: string; notes: 'paper' | 'soft'; mindmap: 'paper' | 'soft'
  notesTransparency: number; mindmapTransparency: number
}
export interface SavedTheme { version: number; settings: ThemeSettings }
export const themeAccent = ref('#526b83')
export const themeError = ref('')
export const savedTheme = ref<SavedTheme>()
export function applyTheme(s: ThemeSettings) {
  const style = document.documentElement.style
  const image = (id: string) => 'url("/api/v1/settings/appearance/images/' + encodeURIComponent(id) + '")'
  for (const target of ['desktop', 'mobile'] as const) {
    const id = s[target] || (target === 'mobile' ? s.desktop : null)
    if (id) style.setProperty('--custom-background-' + target, image(id))
    else style.removeProperty('--custom-background-' + target)
  }
  style.setProperty('--background-position-desktop', s.desktopX + '% ' + s.desktopY + '%')
  style.setProperty('--background-position-mobile', s.mobileX + '% ' + s.mobileY + '%')
  style.setProperty('--background-overlay', String(s.overlay / 100))
  style.setProperty('--color-primary', s.accent)
  themeAccent.value = s.accent
  setAppearancePreference('notes', s.notes)
  setAppearancePreference('mindmap', s.mindmap)
  setSurfaceTransparency('notes', s.notesTransparency)
  setSurfaceTransparency('mindmap', s.mindmapTransparency)
}
export async function loadServerTheme() {
  try {
    const value = await api<SavedTheme>('/settings/appearance')
    savedTheme.value = value
    if (value.version > 0) applyTheme(value.settings)
    themeError.value = ''
  } catch (error) { themeError.value = error instanceof Error ? error.message : '读取外观失败' }
}
