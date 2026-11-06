<script setup lang="ts">
import { Button as AButton, Card as ACard, Checkbox as ACheckbox, Col as ACol, Descriptions as ADescriptions, DescriptionsItem as ADescriptionsItem, FormItem as AFormItem, Input as AInput, Row as ARow, Tag as ATag } from 'ant-design-vue'
import { Plus, Trash2, WandSparkles, ExternalLink } from 'lucide-vue-next'
import { onBeforeUnmount, ref, watch } from 'vue'
import type { VaultLogin } from './entries'
import { generatePassword } from './password-generator'
import VaultSecretInput from './VaultSecretInput.vue'

const entry = defineModel<VaultLogin>({ required: true })
const props = withDefaults(defineProps<{ editing?: boolean; disabled?: boolean; prefix?: string }>(), { prefix: 'vault-entry' })
const emit = defineEmits<{ notice: [text: string] }>()
const visible = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
function hide() { clearTimeout(timer); visible.value = '' }
function reveal(id: string) { if (visible.value === id) hide(); else { hide(); visible.value = id; timer = setTimeout(hide, 30000) } }
async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); emit('notice', '已复制到剪贴板。') }
  catch { emit('notice', '复制失败，请点击显示后手动选择复制。') }
}
function generate() {
  try { entry.value.password = generatePassword({ length: 20, kinds: ['uppercase', 'lowercase', 'digits', 'symbols'] }); hide(); emit('notice', '已生成并填入编辑草稿，请确认后保存。') }
  catch { emit('notice', '安全随机源不可用，生成失败。') }
}
function addField() { entry.value.fields.push({ id: crypto.randomUUID(), label: '', value: '', hidden: false }) }
function safeUrl(value: string | undefined) {
  if (!value) return undefined
  try { const url = new URL(value); if (url.protocol === 'https:' || url.protocol === 'http:') return url.href } catch { /* Show other values as text. */ }
  return undefined
}
function visibility() { if (document.hidden) hide() }
document.addEventListener('visibilitychange', visibility)
watch(() => [entry.value.id, props.editing], hide)
onBeforeUnmount(() => { hide(); document.removeEventListener('visibilitychange', visibility) })
</script>

<template>
  <div class="vault-entry-fields">
    <template v-if="editing">
      <ACard title="账号信息" size="small" :bordered="false" class="vault-field-section">
        <ARow :gutter="20">
          <ACol :xs="24" :lg="14"><AFormItem label="条目名称" html-for="vault-entry-name" required><AInput id="vault-entry-name" v-model:value="entry.name" :maxlength="240" :disabled="disabled" autocomplete="off" placeholder="例如：个人邮箱" /></AFormItem></ACol>
          <ACol :xs="24" :lg="10"><AFormItem label="用户名" html-for="vault-entry-username"><AInput id="vault-entry-username" v-model:value="entry.username" :maxlength="4096" :disabled="disabled" autocomplete="off" placeholder="邮箱或登录账号" /></AFormItem></ACol>
        </ARow>
        <AFormItem label="密码" :html-for="prefix + '-password-' + entry.id">
          <VaultSecretInput :id="prefix + '-password-' + entry.id" v-model="entry.password" :visible="visible === 'password'" :disabled="disabled" :maxlength="8192" show-label="显示密码" hide-label="隐藏密码" copy-label="复制密码" @reveal="reveal('password')" @copy="copy(entry.password)" />
          <div class="vault-password-helper"><span>显示 30 秒后自动隐藏</span><AButton type="link" size="small" :disabled="disabled" @click="generate"><WandSparkles :size="14" aria-hidden="true" />生成 20 位密码</AButton></div>
        </AFormItem>
        <AFormItem label="网址">
          <div v-for="(urlValue, urlIndex) in entry.urls" :key="urlIndex" class="vault-field-row">
            <AInput :value="urlValue" :aria-label="`网址 ${urlIndex + 1}`" :maxlength="4096" :disabled="disabled" placeholder="请输入完整网址" @update:value="entry.urls[urlIndex] = $event" />
            <AButton type="text" :disabled="disabled" :aria-label="`移除网址 ${urlIndex + 1}`" @click="entry.urls.splice(urlIndex, 1)"><Trash2 :size="16" aria-hidden="true" /></AButton>
          </div>
          <AButton type="dashed" :disabled="disabled || entry.urls.length >= 20" @click="entry.urls.push('')"><Plus :size="15" aria-hidden="true" />添加网址</AButton>
        </AFormItem>
      </ACard>
      <ACard title="备注与分类" size="small" :bordered="false" class="vault-field-section">
        <AFormItem label="备注" html-for="vault-entry-notes"><AInput.TextArea id="vault-entry-notes" v-model:value="entry.notes" :rows="3" :maxlength="65536" :disabled="disabled" placeholder="添加账号用途或其他说明" /></AFormItem>
        <AFormItem label="标签">
          <div class="vault-tags-editor">
            <div v-for="(_, index) in entry.tags" :key="index" class="vault-field-row"><AInput v-model:value="entry.tags[index]" :aria-label="`标签 ${index + 1}`" :maxlength="100" :disabled="disabled" /><AButton type="text" :disabled="disabled" :aria-label="`移除标签 ${index + 1}`" @click="entry.tags.splice(index, 1)"><Trash2 :size="14" aria-hidden="true" /></AButton></div>
            <AButton type="dashed" :disabled="disabled || entry.tags.length >= 50" @click="entry.tags.push('')"><Plus :size="15" aria-hidden="true" />添加标签</AButton>
          </div>
        </AFormItem>
        <ACheckbox v-model:checked="entry.favorite" :disabled="disabled">收藏此条目</ACheckbox>
      </ACard>
      <ACard title="自定义字段" size="small" :bordered="false" class="vault-field-section">
        <div v-for="(field, index) in entry.fields" :key="field.id" class="vault-custom-field">
          <div class="vault-custom-field-heading"><span>字段 {{ index + 1 }}</span><AButton type="text" :disabled="disabled" :aria-label="`移除字段 ${index + 1}`" @click="entry.fields.splice(index, 1)"><Trash2 :size="15" aria-hidden="true" /></AButton></div>
          <AFormItem :label="`字段名称 ${index + 1}`" :html-for="'vault-field-label-' + field.id" required><AInput :id="'vault-field-label-' + field.id" v-model:value="field.label" :maxlength="120" :disabled="disabled" /></AFormItem>
          <AFormItem :label="`字段值 ${index + 1}`" :html-for="prefix + '-field-value-' + field.id">
            <VaultSecretInput v-if="field.hidden" :id="prefix + '-field-value-' + field.id" v-model="field.value" :visible="visible === field.id" :disabled="disabled" :maxlength="8192" show-label="显示字段内容" hide-label="隐藏字段内容" :copy-label="`复制字段 ${index + 1}`" @reveal="reveal(field.id)" @copy="copy(field.value)" />
            <AInput v-else :id="prefix + '-field-value-' + field.id" v-model:value="field.value" :maxlength="8192" :disabled="disabled" autocomplete="off" />
          </AFormItem>
          <ACheckbox v-model:checked="field.hidden" :disabled="disabled">隐藏字段 {{ index + 1 }}</ACheckbox>
        </div>
        <AButton type="dashed" block :disabled="disabled || entry.fields.length >= 30" @click="addField"><Plus :size="15" aria-hidden="true" />添加自定义字段</AButton>
      </ACard>
    </template>
    <template v-else>
      <ADescriptions :column="1" :colon="false" class="vault-account-description">
        <ADescriptionsItem label="用户名"><span class="vault-detail-value">{{ entry.username || '未填写' }}</span></ADescriptionsItem>
        <ADescriptionsItem><template #label><label :for="prefix + '-password-' + entry.id">密码</label></template>
          <VaultSecretInput :id="prefix + '-password-' + entry.id" v-model="entry.password" :visible="visible === 'password'" readonly :disabled="disabled" show-label="显示密码" hide-label="隐藏密码" copy-label="复制密码" @reveal="reveal('password')" @copy="copy(entry.password)" />
        </ADescriptionsItem>
        <ADescriptionsItem label="网址"><div v-if="entry.urls.length" class="vault-detail-links"><template v-for="url in entry.urls" :key="url"><a v-if="safeUrl(url)" :href="safeUrl(url)" target="_blank" rel="noopener noreferrer">{{ url }}<ExternalLink :size="13" aria-hidden="true" /></a><span v-else>{{ url }}</span></template></div><span v-else class="vault-muted">未填写</span></ADescriptionsItem>
        <ADescriptionsItem label="标签"><div v-if="entry.tags.some(Boolean)" class="vault-detail-tags"><ATag v-for="tag in entry.tags.filter(Boolean)" :key="tag">{{ tag }}</ATag></div><span v-else class="vault-muted">未填写</span></ADescriptionsItem>
      </ADescriptions>
      <ACard title="备注" size="small" :bordered="false" class="vault-field-section vault-readonly-section"><p class="vault-note-value">{{ entry.notes || '暂无备注' }}</p></ACard>
      <ACard v-if="entry.fields.length" title="自定义字段" size="small" :bordered="false" class="vault-field-section vault-readonly-section">
        <ADescriptions :column="1" :colon="false">
          <ADescriptionsItem v-for="(field, index) in entry.fields" :key="field.id"><template #label><label :for="prefix + '-field-value-' + field.id">{{ field.label }}</label></template>
            <VaultSecretInput v-if="field.hidden" :id="prefix + '-field-value-' + field.id" v-model="field.value" :visible="visible === field.id" readonly show-label="显示字段内容" hide-label="隐藏字段内容" :copy-label="`复制字段 ${index + 1}`" @reveal="reveal(field.id)" @copy="copy(field.value)" />
            <AInput v-else :id="prefix + '-field-value-' + field.id" v-model:value="field.value" readonly />
          </ADescriptionsItem>
        </ADescriptions>
      </ACard>
      <p class="vault-detail-footnote">修改于 {{ new Date(entry.updatedAt).toLocaleString('zh-CN') }} · 密码显示 30 秒后隐藏</p>
    </template>
  </div>
</template>
