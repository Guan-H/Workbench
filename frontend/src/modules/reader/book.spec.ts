import { describe, expect, it } from 'vitest'
import { textBook, parseLocator } from './book'

describe('novel text navigation', () => {
  it('groups volumes and chapters without interpreting narrative mentions as headings', () => {
    const bytes = new TextEncoder().encode('\ufeff序章\r\n他想起第一章的内容。\r\n第一卷 初入江湖\r\n第一章 少年\r\n正文\r\n第123章 重逢\r\n尾声')
    const result = textBook(bytes, 'auto')
    expect(result.chapters.map(item => item.title)).toEqual(['序章','第一卷 初入江湖'])
    expect(result.chapters[1]?.children?.map(item => item.title)).toEqual(['第一章 少年','第123章 重逢','尾声'])
    expect(result.chunks.flatMap(item => item.blocks).find(item => item.text.startsWith('他想起'))?.heading).toBe(false)
  })
  it('strictly rejects malformed text and invalid persisted locations', () => {
    expect(() => textBook(new Uint8Array([0xc3,0x28]), 'UTF-8')).toThrow()
    expect(parseLocator('{"v":1,"part":"text","block":-1,"offset":0,"encoding":"auto"}')).toBeUndefined()
  })
})
