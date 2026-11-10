/// <reference lib="webworker" />
import { textBook } from './book'
import { markdownBook } from './markdown-book'
self.onmessage = (event: MessageEvent<{ bytes: Uint8Array; encoding: string; markdown?: boolean }>) => {
  try {
    const { chunks, chapters, warning } = event.data.markdown ? markdownBook(event.data.bytes) : textBook(event.data.bytes, event.data.encoding)
    self.postMessage({ chunks, chapters, warning })
  } catch (cause) { self.postMessage({ error: cause instanceof Error ? cause.message : 'TXT 读取失败。' }) }
}
