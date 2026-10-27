import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import App from './App.vue'

describe('App', () => {
  it('renders the initialized project status', () => {
    const wrapper = mount(App)

    expect(wrapper.get('h1').text()).toBe('私有空间')
    expect(wrapper.text()).toContain('工程骨架已启动')
  })
})
