<script setup lang="ts">
import { Button as AButton } from 'ant-design-vue'
import { ref } from 'vue'
import type { VaultEntry } from './entries'
import type { EntryAvatar } from './entry-avatar'
import VaultAvatarPicker from './VaultAvatarPicker.vue'
import VaultEntryAvatar from './VaultEntryAvatar.vue'
import VaultLoginFields from './VaultLoginFields.vue'
import VaultSecureNoteFields from './VaultSecureNoteFields.vue'

const entry = defineModel<VaultEntry>({ required: true })
defineProps<{ editing?: boolean; disabled?: boolean; prefix?: string }>()
const emit = defineEmits<{ notice: [text: string] }>()
const choosingAvatar = ref(false)
function chooseIcon(icon: EntryAvatar | undefined) {
  if (icon) entry.value.icon = icon
  else delete entry.value.icon
  choosingAvatar.value = false
}
</script>

<template>
  <div v-if="editing" class="vault-avatar-editor"><VaultEntryAvatar :name="entry.name" :icon="entry.icon" :size="42" /><span>条目头像</span><AButton :disabled="disabled" @click="choosingAvatar = true">选择头像</AButton></div>
  <VaultLoginFields v-if="entry.type === 'login'" :model-value="entry" :editing="editing" :disabled="disabled" :prefix="prefix" @update:model-value="entry = $event" @notice="emit('notice', $event)" />
  <VaultSecureNoteFields v-else :model-value="entry" :editing="editing" :disabled="disabled" @update:model-value="entry = $event" />
  <VaultAvatarPicker v-if="choosingAvatar && editing" :name="entry.name" :icon="entry.icon" @close="choosingAvatar = false" @choose="chooseIcon" />
</template>

<style scoped>
.vault-avatar-editor { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 4px 0 18px; border-bottom: 1px solid var(--color-border); }
.vault-avatar-editor > span:nth-child(2) { flex: 1; font-size: 13px; }
</style>
