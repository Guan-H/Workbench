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
})
