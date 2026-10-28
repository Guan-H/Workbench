<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { keymap } from '@codemirror/view'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; save: [] }>()
const host = ref<HTMLElement>()
let editor: EditorView | undefined
let applying = false
const separator = props.modelValue.includes('\r\n') ? '\r\n' : '\n'
const normalize = (value: string) => value.replace(/\r\n?/g, '\n')
onMounted(() => {
  editor = new EditorView({ parent: host.value, state: EditorState.create({
    doc: normalize(props.modelValue),
    extensions: [basicSetup, markdown({ codeLanguages: languages }), EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': 'Markdown 正文', 'data-testid': 'markdown-editor' }),
      keymap.of([{ key: 'Mod-s', run: () => { emit('save'); return true } }]),
      EditorView.updateListener.of((update) => { if (update.docChanged && !applying) emit('update:modelValue', update.state.sliceDoc().replace(/\n/g, separator)) }),
    ],
  }) })
})
watch(() => props.modelValue, (value) => {
  if (!editor || normalize(value) === editor.state.sliceDoc()) return
  applying = true
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: normalize(value) } })
  applying = false
})
onBeforeUnmount(() => editor?.destroy())
</script>
<template><div ref="host" class="markdown-editor" /></template>
