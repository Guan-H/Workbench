import {describe,it,expect} from 'vitest'
import {markdownBook} from './markdown-book'
describe('Markdown novel model',()=>{
  it('keeps heading hierarchy, readable inline text and image references without executing HTML',()=>{
    const book=markdownBook(new TextEncoder().encode('# 第一章\n\n**正文**与 `代码`。\n\n## 子章节\n\n![插图](images/test.png)\n\n<script>alert(1)</script>'))
    expect(book.chapters[0]?.title).toBe('第一章')
    expect(book.chapters[0]?.children?.[0]?.title).toBe('子章节')
    const blocks=book.chunks.flatMap(chunk=>chunk.blocks)
    expect(blocks.some(block=>block.text==='正文与 代码。')).toBe(true)
    expect(blocks.find(block=>block.image)?.image).toBe('images/test.png')
    expect(blocks.some(block=>block.text.includes('<script>'))).toBe(true)
  })
})
