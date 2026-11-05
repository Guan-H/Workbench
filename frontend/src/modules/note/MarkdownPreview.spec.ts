import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MarkdownPreview from './MarkdownPreview'

const PreviewHost = defineComponent({
  props: { source: String, path: String, enabled: { type: Boolean, default: true } },
  setup: props => () => h('article', [h(MarkdownPreview, { source: props.source ?? '', path: props.path ?? '', enabled: props.enabled })]),
})

describe('MarkdownPreview DOM updates', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it.each(['\n', '\r\n'])('preserves ordinary line breaks in a paragraph (%j)', newline => {
    const wrapper = mount(PreviewHost, { props: { source: '# 换行\n\n' + ['asdasd', 'asdasd', 'asdasd'].join(newline), path: '换行.md' } })
    expect(wrapper.get('p').findAll('br')).toHaveLength(2)
    expect(wrapper.get('p').element.innerHTML).toMatch(/asdasd<br>\s*asdasd<br>\s*asdasd/)
    wrapper.unmount()
  })

  it('keeps blank-line paragraphs, explicit breaks and code-block newlines distinct', () => {
    const wrapper = mount(PreviewHost, { props: { source: '# 段落\n\n第一段\n\n第二段  \n下一行\n\n```text\n代码一\n代码二\n```', path: '段落.md' } })
    expect(wrapper.findAll('p')).toHaveLength(2)
    expect(wrapper.findAll('br')).toHaveLength(1)
    expect(wrapper.get('pre code').text()).toContain('代码一\n代码二')
    expect(wrapper.get('pre').findAll('br')).toHaveLength(0)
    wrapper.unmount()
  })

  it('retains an image when surrounding text changes or paragraphs are inserted', async () => {
    const wrapper = mount(PreviewHost, { props: { source: '# 标题\n\n说明 ![图](<图片 1.png>)\n', path: '目录/笔记.md' } })
    const image = wrapper.get('img').element
    await wrapper.setProps({ source: '# 新标题\n\n新段落\n\n修改说明 ![图](<图片 1.png>)\n' })
    await vi.advanceTimersByTimeAsync(250)
    expect(wrapper.get('img').element).toBe(image)
    expect(wrapper.text()).toContain('新标题')
    expect(wrapper.get('img').attributes('src')).toContain(encodeURIComponent('目录/图片 1.png'))
    await wrapper.setProps({ source: '![另一图](<图片 2.png>)' })
    await vi.advanceTimersByTimeAsync(250)
    expect(wrapper.get('img').attributes('src')).toContain(encodeURIComponent('目录/图片 2.png'))
    wrapper.unmount()
  })

  it('defers hidden previews and preserves sanitization and task-list behavior', async () => {
    const wrapper = mount(PreviewHost, { props: { source: '# 原始标题', path: '笔记.md', enabled: false } })
    expect(wrapper.find('h1').exists()).toBe(false)
    await wrapper.setProps({ source: '# 最新标题\n\n- [x] 已完成\n\n<script>alert(1)</script>\n\n![外部](https://example.invalid/a.png)', enabled: true })
    expect(wrapper.text()).toContain('最新标题')
    expect((wrapper.get('input').element as HTMLInputElement).disabled).toBe(true)
    expect((wrapper.get('input').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
    wrapper.unmount()
  })

  it('retains safe new-tab attributes after sanitizing external, note and attachment links', () => {
    const wrapper = mount(PreviewHost, { props: {
      source: '# 链接\n\n[笔记](<目标 文档.md>) [外部](https://example.invalid/) [附件](<图片 1.png>) [危险](javascript:alert(1))',
      path: '目录/来源.md',
    } })
    const links = wrapper.findAll('a')
    expect(links).toHaveLength(3)
    for (const link of links) {
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toBe('noopener noreferrer')
    }
    expect(links[0]?.attributes('href')).toBe('?note=' + encodeURIComponent('目录/目标 文档.md'))
    expect(links[2]?.attributes('href')).toBe('/api/v1/files/content?path=' + encodeURIComponent('目录/图片 1.png'))
    wrapper.unmount()
  })

  it('clears unfinished image sources on pause and unmount, while retaining decoded images on pause', async () => {
    const wrapper = mount(PreviewHost, { props: { source: '![图](a.png)', path: '笔记.md' } })
    const image = wrapper.get('img').element
    await wrapper.setProps({ enabled: false })
    expect(image.hasAttribute('src')).toBe(false)
    await wrapper.setProps({ enabled: true })
    expect(image.getAttribute('src')).toContain('a.png')
    wrapper.unmount()
    expect(image.hasAttribute('src')).toBe(false)

    const loaded = mount(PreviewHost, { props: { source: '![图](b.png)', path: '笔记.md' } })
    await loaded.get('img').trigger('load')
    await loaded.setProps({ enabled: false })
    expect(loaded.get('img').attributes('src')).toContain('b.png')
    loaded.unmount()
  })

  it('does not follow a surrounding link when retrying a failed image', async () => {
    const wrapper = mount(PreviewHost, { props: { source: '[![图](a.png)](https://example.invalid/)', path: '笔记.md' } })
    await wrapper.get('img').trigger('error')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    wrapper.get('button').element.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    wrapper.unmount()
  })
})
