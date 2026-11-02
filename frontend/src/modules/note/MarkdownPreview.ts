import { createTextVNode, defineComponent, h, onBeforeUnmount, shallowRef, watch, type VNode } from 'vue'
import { renderMarkdown } from './markdown'

/** Patch sanitized preview nodes so unchanged private images keep their loaded DOM elements. */
function previewNodes(html: string): VNode[] {
  const template = document.createElement('template')
  template.innerHTML = html
  function children(parent: ParentNode): VNode[] {
    const images = new Map<string, number>()
    return Array.from(parent.childNodes).flatMap(node => {
      if (node.nodeType === Node.TEXT_NODE) return [createTextVNode(node.textContent ?? '')]
      if (!(node instanceof Element)) return []
      const attributes: Record<string, string | number> = Object.fromEntries(
        Array.from(node.attributes, attribute => [attribute.name, attribute.value]),
      )
      // Keep image-containing blocks stable even when text paragraphs are inserted before them.
      const sources = node.matches('img') ? [node.getAttribute('src')] :
        Array.from(node.querySelectorAll('img'), image => image.getAttribute('src'))
      if (sources.length) {
        const signature = JSON.stringify([node.localName, sources])
        const occurrence = images.get(signature) ?? 0
        images.set(signature, occurrence + 1)
        attributes.key = `${signature}:${occurrence}`
      }
      return [h(node.localName, attributes, children(node))]
    })
  }
  return children(template.content)
}

export default defineComponent({
  name: 'MarkdownPreview',
  props: {
    source: { type: String, required: true },
    path: { type: String, required: true },
    enabled: { type: Boolean, default: true },
  },
  setup(props) {
    const nodes = shallowRef<VNode[]>([])
    let timer: ReturnType<typeof setTimeout> | undefined
    const render = () => { nodes.value = previewNodes(renderMarkdown(props.source, props.path)) }
    watch([() => props.source, () => props.path, () => props.enabled], (values, previous) => {
      clearTimeout(timer)
      if (!props.enabled) return
      if (!previous || values[1] !== previous[1] || !previous[2]) render()
      else timer = setTimeout(render, 250)
    }, { immediate: true })
    onBeforeUnmount(() => clearTimeout(timer))
    return () => nodes.value
  },
})
