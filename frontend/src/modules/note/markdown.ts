import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'

export function relativePath(base: string, target: string) {
  if (target.startsWith('#')) return null
  try { target = decodeURIComponent(target.split(/[?#]/)[0] ?? '') } catch { return null }
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(target)) return null
  const segments = base.split('/').slice(0, -1)
  for (const segment of target.split('/')) {
    if (segment === '.' || !segment) continue
    if (segment === '..') { if (!segments.length) return null; segments.pop() }
    else segments.push(segment)
  }
  return segments.join('/')
}

export function renderMarkdown(source: string, path: string) {
  const md = new MarkdownIt({ html: false, linkify: true, highlight(code, language) {
    return language && hljs.getLanguage(language) ? hljs.highlight(code, { language }).value : ''
  } }).use(taskLists, { enabled: false })
  md.renderer.rules.heading_open = (tokens, index, options, _env, renderer) => {
    const line = tokens[index]?.map?.[0]
    if (line !== undefined) tokens[index]!.attrSet('data-source-line', String(line))
    return renderer.renderToken(tokens, index, options)
  }
  md.renderer.rules.image = (tokens, index) => {
    const token = tokens[index]!
    const target = relativePath(path, String(token.attrGet('src') ?? ''))
    if (!target || !/\.(png|jpe?g|webp)$/i.test(target)) return '<span class="blocked-image">[图片未加载：仅显示库内 PNG/JPEG/WebP 图片]</span>'
    return `<img src="/api/v1/files/content?path=${encodeURIComponent(target)}" alt="${md.utils.escapeHtml(token.content)}" loading="lazy" />`
  }
  const defaultLink = md.renderer.rules.link_open
  md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    const token = tokens[index]!
    const href = String(token.attrGet('href') ?? '')
    const target = relativePath(path, href)
    if (target && /\.md$/i.test(target)) { token.attrSet('href', '#'); token.attrSet('data-note-path', target) }
    else {
      if (target) token.attrSet('href', `/api/v1/files/content?path=${encodeURIComponent(target)}`)
      token.attrSet('target', '_blank'); token.attrSet('rel', 'noopener noreferrer')
    }
    return defaultLink ? defaultLink(tokens, index, options, env, renderer) : renderer.renderToken(tokens, index, options)
  }
  return DOMPurify.sanitize(md.render(source), { FORBID_TAGS: ['style', 'iframe', 'object', 'embed'], FORBID_ATTR: ['style'], ADD_ATTR: ['data-note-path', 'data-source-line'] })
}
