<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Input as AInput } from 'ant-design-vue'
import { Check, Search, X } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppDialog from '../../shared/AppDialog.vue'
import AppPagination from '../../shared/AppPagination.vue'
import VaultEntryAvatar from './VaultEntryAvatar.vue'
import { entryIcons } from './entry-icons'
import type { CustomEntryAvatar, EntryAvatar } from './entry-avatar'
import { createCustomAvatar } from './custom-avatar'

const props = defineProps<{ name: string; icon?: EntryAvatar; avatars?: CustomEntryAvatar[] }>()
const emit = defineEmits<{ close: []; choose: [icon: EntryAvatar | undefined] }>()
const selected = ref(props.icon)
const custom = ref<CustomEntryAvatar | undefined>(typeof props.icon === 'object' ? props.icon : undefined)
const fileInput = ref<HTMLInputElement>()
const processing = ref(false)
const imageError = ref('')
let disposed = false
const query = ref('')
const page = ref(1)
const matches = computed(() => entryIcons.filter(icon => `${icon.label} ${icon.aliases}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
const pages = computed(() => Math.max(1, Math.ceil(matches.value.length / 10)))
const visible = computed(() => matches.value.slice((page.value - 1) * 10, page.value * 10))
const selectedLabel = computed(() => typeof selected.value === 'object' ? '自定义头像' : entryIcons.find(icon => icon.id === selected.value)?.label ?? '默认首字头像')
watch(query, () => { page.value = 1 })
async function chooseFile(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || processing.value) return
  processing.value = true; imageError.value = ''
  try {
    const avatar = await createCustomAvatar(file)
    if (!disposed) { custom.value = avatar; selected.value = avatar }
  } catch (cause) { if (!disposed) imageError.value = cause instanceof Error ? cause.message : '图片处理失败，请重试。' }
  finally { if (!disposed) processing.value = false }
}
function key(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation() }
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close') }
}
onMounted(async () => { await nextTick(); document.getElementById('vault-icon-query')?.focus() })
onBeforeUnmount(() => { disposed = true; custom.value = undefined })
</script>

<template>
  <AppDialog label="选择条目头像">
    <section class="modal vault-avatar-picker" @keydown="key">
      <header><h2>选择条目头像</h2><AButton type="text" class="icon-button" aria-label="关闭头像选择" title="关闭头像选择" @click="emit('close')"><X :size="18" aria-hidden="true" /></AButton></header>
      <div class="vault-avatar-picker-body">
        <AButton class="vault-avatar-default" aria-label="默认首字头像" :aria-pressed="selected === undefined" :disabled="processing" @click="selected = undefined"><VaultEntryAvatar :name="name" :size="36" /><span>默认首字头像</span><Check v-if="selected === undefined" :size="16" aria-hidden="true" /></AButton>
        <div class="vault-custom-choice">
          <AButton v-if="custom" class="vault-avatar-default" aria-label="使用自定义头像" :aria-pressed="typeof selected === 'object'" :disabled="processing" @click="selected = custom"><VaultEntryAvatar :name="name" :icon="custom" :size="36" /><span>自定义头像</span><Check v-if="typeof selected === 'object'" :size="16" aria-hidden="true" /></AButton>
          <input ref="fileInput" type="file" accept="image/png,image/jpeg" aria-label="自定义头像图片" hidden @change="chooseFile" />
          <AButton :loading="processing" @click="fileInput?.click()">{{ custom ? '更换图片' : '选择自定义图片' }}</AButton>
          <p>PNG/JPEG，最大 2 MiB。保存条目后加入加密头像库，删除条目后仍可复用，计入保险库容量。</p>
          <AAlert v-if="imageError" :message="imageError" type="error" show-icon role="alert" />
        </div>
        <template v-if="avatars?.length"><h3>我的头像 · {{ avatars.length }}</h3><div class="vault-avatar-options" aria-label="已保存的自定义头像"><AButton v-for="(avatar, index) in avatars" :key="avatar.dataUrl" :aria-label="`使用已保存头像 ${index + 1}`" :aria-pressed="typeof selected === 'object' && selected.dataUrl === avatar.dataUrl" :disabled="processing" @click="selected = avatar; custom = avatar"><VaultEntryAvatar :name="name" :icon="avatar" :size="36" /><span>头像 {{ index + 1 }}</span><Check v-if="typeof selected === 'object' && selected.dataUrl === avatar.dataUrl" class="vault-avatar-check" :size="13" aria-hidden="true" /></AButton></div></template>
        <label for="vault-icon-query">搜索平台</label><AInput id="vault-icon-query" v-model:value="query" placeholder="搜索名称，如 谷歌、ChatGPT、抖音" :maxlength="100" allow-clear><template #prefix><Search :size="15" aria-hidden="true" /></template></AInput>
        <div class="vault-avatar-options" aria-label="平台头像选项"><AButton v-for="icon in visible" :key="icon.id" :aria-label="`选择 ${icon.label} 头像`" :aria-pressed="selected === icon.id" :disabled="processing" :title="icon.label" @click="selected = icon.id"><VaultEntryAvatar :name="name" :icon="icon.id" :size="36" /><span>{{ icon.label }}</span><Check v-if="selected === icon.id" class="vault-avatar-check" :size="13" aria-hidden="true" /></AButton><p v-if="!matches.length" role="status">没有匹配的平台</p></div>
        <nav class="vault-avatar-pages" aria-label="平台头像分页"><span>共 {{ matches.length }} 个平台 · 第 {{ page }}/{{ pages }} 页 · 10 个/页</span><AppPagination v-model:page="page" :pages="pages" :total="matches.length" :page-size="10" /></nav>
      </div>
      <footer><span class="vault-avatar-current">已选：{{ selectedLabel }}</span><AButton @click="emit('close')">取消</AButton><AButton type="primary" :disabled="processing" @click="emit('choose', selected)">使用此头像</AButton></footer>
    </section>
  </AppDialog>
</template>

<style scoped>
.vault-avatar-picker-body { display: grid; gap: 12px; max-height: 60dvh; overflow-y: auto; padding: 20px 24px; }
.vault-avatar-default.ant-btn { justify-content: flex-start; padding: 8px 12px; height: auto; }
.vault-avatar-default > span:nth-child(2) { flex: 1; text-align: left; }
.vault-avatar-options { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
.vault-avatar-options .ant-btn { flex-direction: column; position: relative; min-width: 0; height: auto; padding: 10px 3px; min-height: 80px; font-size: 12px; white-space: normal; }
.vault-avatar-options [aria-pressed=true], .vault-avatar-default[aria-pressed=true] { border-color: var(--color-primary); background: var(--color-selection); color: var(--color-primary); }
.vault-avatar-check { position: absolute; top: 5px; right: 5px; }
.vault-avatar-pages { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.vault-avatar-pages > span, .vault-avatar-current { color: var(--color-text-muted); font-size: 12px; }
.vault-avatar-picker footer { flex-wrap: wrap; gap: 8px; padding: 14px 24px; border-top: 1px solid var(--color-border); }
.vault-avatar-current { margin-right: auto; }
.vault-custom-choice { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--color-border); border-radius: 6px; }
.vault-custom-choice > p { margin: 0; color: var(--color-text-muted); font-size: 12px; }
@media (max-width: 540px) { .vault-avatar-options { grid-template-columns: repeat(3, minmax(0, 1fr)); } .vault-avatar-picker-body { padding: 16px; } }
</style>
