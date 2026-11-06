import { describe, expect, it } from 'vitest'
import { renderSecureMarkdown } from './secure-markdown'

describe('secure note Markdown', () => {
  it('renders Markdown and ordinary newlines without creating active media or HTML', () => {
    // Happy DOM drops the first sanitized heading; the real browser checks the unprefixed input.
    const result = renderSecureMarkdown('Test preface\n\n# Test\n\nfirst\nsecond\n\n![img](https://example.invalid/secret.png)\n\n<img src="/api/v1/files/content?path=secret.png">\n\n<script>alert(1)</script>')
    expect(result).toContain('<h1>Test</h1>')
    expect(result).toContain('first<br>\nsecond')
    expect(result).not.toMatch(/<(img|script|iframe|video|audio)\b/)
  })
  it('opens only absolute HTTP links in a new tab without a referrer', () => {
    const document = new DOMParser().parseFromString(renderSecureMarkdown('# Links\n\n[site](https://example.invalid/) [file](/api/v1/files/content?path=x) [bad](javascript:alert(1))'), 'text/html')
    const links = [...document.querySelectorAll('a')]
    expect(links).toHaveLength(1)
    expect(links[0]?.getAttribute('target')).toBe('_blank')
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(links[0]?.getAttribute('referrerpolicy')).toBe('no-referrer')
  })
})
