<script setup lang="ts">
import { Button as AButton, Card as ACard, Checkbox as ACheckbox, FormItem as AFormItem, Input as AInput, RadioButton as ARadioButton, RadioGroup as ARadioGroup, Tag as ATag } from 'ant-design-vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import type { VaultSecureNote } from './entries'
import { renderSecureMarkdown } from './secure-markdown'

const entry = defineModel<VaultSecureNote>({ required: true })
defineProps<{ editing?: boolean; disabled?: boolean }>()
const mode = ref('edit')
const rendered = computed(() => renderSecureMarkdown(entry.value.body))
watch(() => entry.value.id, () => { mode.value = 'edit' })
</script>

<template>
  <div class="vault-entry-fields vault-secure-note">
    <template v-if="editing">
      <ACard title="安全笔记" size="small" :bordered="false" class="vault-field-section">
        <AFormItem label="条目名称" html-for="vault-entry-name" required><AInput id="vault-entry-name" v-model:value="entry.name" :maxlength="240" :disabled="disabled" autocomplete="off" placeholder="为安全笔记命名" /></AFormItem>
        <div class="vault-secure-note-toolbar"><ARadioGroup v-model:value="mode" size="small" aria-label="安全笔记编辑模式"><ARadioButton value="edit">编辑</ARadioButton><ARadioButton value="preview">预览</ARadioButton></ARadioGroup><span>Markdown · 不支持附件</span></div>
        <AFormItem v-if="mode === 'edit'" label="安全笔记正文" html-for="vault-secure-body"><AInput.TextArea id="vault-secure-body" v-model:value="entry.body" :rows="12" :maxlength="65536" :disabled="disabled" autocomplete="off" :spellcheck="false" placeholder="支持标题、列表、代码等 Markdown 文本" /></AFormItem>
        <section v-else aria-label="安全笔记预览" class="vault-secure-preview" v-html="rendered" />
        <p class="vault-muted">内容在浏览器内加密，不进入普通笔记、附件上传或本地同步。</p>
      </ACard>
      <ACard title="分类" size="small" :bordered="false" class="vault-field-section">
        <AFormItem label="标签"><div class="vault-tags-editor"><div v-for="(_, index) in entry.tags" :key="index" class="vault-field-row"><AInput v-model:value="entry.tags[index]" :aria-label="`标签 ${index + 1}`" :maxlength="100" :disabled="disabled" /><AButton type="text" :disabled="disabled" :aria-label="`移除标签 ${index + 1}`" @click="entry.tags.splice(index, 1)"><Trash2 :size="14" aria-hidden="true" /></AButton></div><AButton type="dashed" :disabled="disabled || entry.tags.length >= 50" @click="entry.tags.push('')"><Plus :size="15" aria-hidden="true" />添加标签</AButton></div></AFormItem>
        <ACheckbox v-model:checked="entry.favorite" :disabled="disabled">收藏此条目</ACheckbox>
      </ACard>
    </template>
    <template v-else>
      <div class="vault-detail-tags"><ATag v-for="tag in entry.tags.filter(Boolean)" :key="tag">{{ tag }}</ATag></div>
      <section aria-label="安全笔记预览" class="vault-secure-preview" v-html="rendered" />
      <p class="vault-detail-footnote">修改于 {{ new Date(entry.updatedAt).toLocaleString('zh-CN') }} · 不参与普通文件同步</p>
    </template>
  </div>
</template>

<style scoped>
.vault-secure-note-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.vault-secure-note-toolbar > span { color: var(--color-text-muted); font-size: 12px; }
.vault-secure-preview { min-height: 160px; overflow-wrap: anywhere; line-height: 1.75; }
.vault-secure-preview :deep(pre) { overflow-x: auto; max-width: 100%; padding: 12px; background: var(--color-background); border-radius: 6px; }
.vault-secure-preview :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
.vault-secure-preview :deep(td), .vault-secure-preview :deep(th) { border: 1px solid var(--color-border); padding: 6px 10px; }
.vault-secure-preview :deep(blockquote) { border-left: 3px solid var(--color-primary); padding-left: 14px; margin-left: 0; }
</style>
