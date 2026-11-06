import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

// No attachment resolver: secure notes must never read remote images or ordinary file APIs.
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false })
markdown.renderer.rules.image = () => '<span>[安全笔记不支持附件]</span>'
markdown.validateLink = href => /^https?:\/\//i.test(href)
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  tokens[index]!.attrSet('target', '_blank')
  tokens[index]!.attrSet('rel', 'noopener noreferrer')
  tokens[index]!.attrSet('referrerpolicy', 'no-referrer')
  return renderer.renderToken(tokens, index, options)
}
export function renderSecureMarkdown(source: string): string {
  return DOMPurify.sanitize(markdown.render(source), {
    ALLOWED_TAGS: ['p', 'span', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 's', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'referrerpolicy', 'start'],
  })
}
