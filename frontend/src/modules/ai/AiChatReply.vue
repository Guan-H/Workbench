<script setup lang="ts">
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const props = defineProps<{ text: string }>()
const markdown = new MarkdownIt({ html: false })
markdown.disable('image')
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  const token = tokens[index]!
  token.attrSet('target', '_blank')
  token.attrSet('rel', 'noopener noreferrer')
  return renderer.renderToken(tokens, index, options)
}
const rendered = computed(() => DOMPurify.sanitize(markdown.render(props.text), { FORBID_TAGS: ['img'], ADD_ATTR: ['target'] }))
</script>

<template>
  <div class="ai-reply-markdown" v-html="rendered"></div>
</template>

<style scoped>
.ai-reply-markdown { min-width: 0; overflow-wrap: anywhere; line-height: 1.75; }
.ai-reply-markdown :deep(pre) { padding: 14px; border-radius: 8px; background: var(--color-background); overflow: auto; }
.ai-reply-markdown :deep(p) { margin: 0 0 .8em; }
.ai-reply-markdown :deep(p:last-child) { margin-bottom: 0; }
.ai-reply-markdown :deep(table) { display: block; max-width: 100%; overflow: auto; }
.ai-reply-markdown :deep(td), .ai-reply-markdown :deep(th) { border: 1px solid var(--color-border); padding: 6px 10px; }
</style>
