<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [text: string]; save: [] }>()
const host = ref<HTMLElement>()
let editor: EditorView | undefined, applying = false
const separator = props.modelValue.includes('\r\n') ? '\r\n' : '\n'
const normalize = (value: string) => value.replace(/\r\n?/g, '\n')
onMounted(() => {
  editor = new EditorView({ parent: host.value, state: EditorState.create({ doc: normalize(props.modelValue), extensions: [basicSetup, EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': 'TXT 正文' }), keymap.of([{ key: 'Mod-s', run: () => { emit('save'); return true } }]),
    EditorView.updateListener.of(update => { if (update.docChanged && !applying) emit('update:modelValue', update.state.sliceDoc().replace(/\n/g, separator)) }),
  ] }) })
})
watch(() => props.modelValue, value => { if (editor && normalize(value) !== editor.state.sliceDoc()) { applying = true; editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: normalize(value) } }); applying = false } })
onBeforeUnmount(() => editor?.destroy())
</script>
<template><div ref="host" class="plain-text-editor" /></template>
<style scoped>.plain-text-editor { height: 100%; overflow: hidden; } .plain-text-editor :deep(.cm-editor) { height: 100%; } .plain-text-editor :deep(.cm-scroller) { overflow: auto; }</style>
