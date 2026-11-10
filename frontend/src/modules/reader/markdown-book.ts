import MarkdownIt from 'markdown-it'
import { chunksFrom, type ReadingBlock, type ReadingChapter, type ReadingBook } from './book'
/** Markdown is parsed as tokens, never executed as author-controlled HTML. */
export function markdownBook(bytes: Uint8Array): ReadingBook {
  const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes)
  const tokens = new MarkdownIt({html:false,linkify:false}).parse(text,{})
  const blocks: ReadingBlock[] = [], chapters: ReadingChapter[] = []
  const stack: {level:number; node:ReadingChapter}[] = []
  let heading = 0
  for (const token of tokens) {
    if (token.type === 'heading_open') heading = Number(token.tag.slice(1))
    if (token.type === 'heading_close') heading = 0
    if (token.type !== 'inline' && token.type !== 'fence' && token.type !== 'code_block') continue
    const children = token.children || []
    const images = children.filter(child=>child.type==='image')
    const value = children.length ? children.map(child => ['text','code_inline'].includes(child.type) ? child.content : ['softbreak','hardbreak'].includes(child.type) ? '\n' : '').join('') : token.content
    if (!value.trim() && !images.length) continue
    const index = blocks.length
    for (let offset=0;offset<value.length;offset+=1800) blocks.push({part:'markdown',index:blocks.length,text:value.slice(offset,offset+1800),heading:heading>0 && offset===0})
    for (const image of images) blocks.push({part:'markdown',index:blocks.length,text:image.content || '插图',heading:false,image:String(image.attrGet('src') || '')})
    if (heading) {
      const node:ReadingChapter={key:`markdown:${index}`,title:value,location:{v:1,part:'markdown',block:index,offset:0,encoding:'UTF-8'}}
      while(stack.length && stack.at(-1)!.level>=heading) stack.pop()
      if(stack.length) (stack.at(-1)!.node.children ||= []).push(node); else chapters.push(node)
      stack.push({level:heading,node})
    }
  }
  if (!blocks.length) blocks.push({part:'markdown',index:0,text:'（空白 Markdown）',heading:false})
  return {chunks:chunksFrom(blocks),chapters,warning:chapters.length ? '' : '未发现 Markdown 标题，仍可连续阅读。',close() {}}
}
