import { entryIcons, type EntryIconId } from './entry-icons'

// Eagerly embed every preset in the bundle. Selecting a platform must not make an identifying HTTP request.
const assets = import.meta.glob<string>('./icons/*.svg', { query: '?raw', import: 'default', eager: true })
export function entryIconDataUrl(id: EntryIconId): string {
  const option = entryIcons.find(icon => icon.id === id)
  if (!option) throw new Error('UNKNOWN_ENTRY_ICON')
  const svg = assets[`./icons/${option.asset}.svg`]
  if (!svg) throw new Error('MISSING_ENTRY_ICON_ASSET')
  return 'data:image/svg+xml,' + encodeURIComponent(svg.replace('<svg ', `<svg fill="${option.color}" `))
}
