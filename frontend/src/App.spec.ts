import { renderToString } from '@vue/server-renderer'
import { createSSRApp } from 'vue'
import { describe, expect, it } from 'vitest'

import App from './App.vue'

describe('App', () => {
  it('does not expose the workspace before account authentication finishes', async () => {
    const html = await renderToString(createSSRApp(App))

    expect(html).toContain('正在连接账户服务')
    expect(html).not.toContain('服务器已保存')
    expect(html).not.toContain('Markdown 正文')
  })
})
