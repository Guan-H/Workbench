<script setup lang="ts">
import { Button as AButton, Dropdown as ADropdown, Input as AInput, Menu as AMenu, MenuItem as AMenuItem } from 'ant-design-vue'
import { Ellipsis, Pencil, Pin, PinOff, Plus, Search, Trash2 } from 'lucide-vue-next'
import type { Conversation } from './chat-api'

defineProps<{
  chats: Conversation[]
  selected?: string
  pending: boolean
  disabled: boolean
  hasMore: boolean
  listError: string
}>()
const query = defineModel<string>('query', { required: true })
const emit = defineEmits<{
  open: [id?: string]
  rename: [chat: Conversation]
  pin: [chat: Conversation]
  remove: [chat: Conversation]
  more: []
  retry: []
}>()
</script>

<template>
  <div class="chat-list">
    <AButton class="new-chat" type="text" :disabled="disabled" @click="emit('open')">
      <Plus :size="17" aria-hidden="true" />新建会话
    </AButton>
    <AInput v-model:value="query" placeholder="搜索会话标题" aria-label="搜索会话标题" :maxlength="100" allow-clear>
      <template #prefix><Search :size="15" aria-hidden="true" /></template>
    </AInput>
    <nav class="chat-list-results" aria-label="历史会话" :aria-busy="pending">
      <p v-if="!chats.length && pending" class="chat-list-note" role="status">正在读取会话…</p>
      <div v-else-if="listError" class="chat-list-note">
        <p role="alert">{{ listError }}</p>
        <AButton type="link" @click="emit('retry')">重试读取</AButton>
      </div>
      <p v-else-if="!chats.length" class="chat-list-note" role="status">{{ query.trim() ? '没有匹配的标题，试试其他关键词。' : '还没有会话。' }}</p>
      <div v-for="chat in chats" :key="chat.id" :data-chat-id="chat.id" class="chat-list-row" :class="{ current: selected === chat.id }">
        <AButton type="text" class="chat-list-open" :aria-current="selected === chat.id ? 'true' : undefined"
          :disabled="disabled" :title="chat.title" @click="emit('open', chat.id)">
          <Pin v-if="chat.pinned" :size="13" class="chat-list-pin" aria-label="已置顶" role="img" />
          <span class="chat-list-title">{{ chat.title }}</span>
        </AButton>
        <ADropdown :trigger="['click']" placement="bottomRight" :disabled="disabled">
          <AButton type="text" class="chat-list-menu" :aria-label="`管理会话：${chat.title}`"
            aria-haspopup="menu" title="会话操作" :disabled="disabled"><Ellipsis :size="18" aria-hidden="true" /></AButton>
          <template #overlay>
            <AMenu aria-label="会话操作">
              <AMenuItem key="rename" @click="emit('rename', chat)"><Pencil :size="15" aria-hidden="true" />重命名</AMenuItem>
              <AMenuItem key="pin" @click="emit('pin', chat)">
                <PinOff v-if="chat.pinned" :size="15" aria-hidden="true" /><Pin v-else :size="15" aria-hidden="true" />
                {{ chat.pinned ? '取消置顶' : '置顶' }}
              </AMenuItem>
              <AMenuItem key="delete" danger @click="emit('remove', chat)"><Trash2 :size="15" aria-hidden="true" />删除</AMenuItem>
            </AMenu>
          </template>
        </ADropdown>
      </div>
      <AButton v-if="hasMore && !listError" type="text" :loading="pending" @click="emit('more')">更多会话</AButton>
    </nav>
  </div>
</template>

<style scoped>
.chat-list { display: flex; flex: 1; min-height: 0; flex-direction: column; gap: 8px; }
.new-chat { justify-content: flex-start; min-height: 42px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); }
.chat-list-results { flex: 1; min-height: 0; overflow: auto; display: grid; align-content: start; gap: 4px; }
.chat-list-note { margin: 8px; color: var(--color-text-muted); font-size: 12px; }
.chat-list-note p { margin: 0; }
.chat-list-row { display: flex; align-items: center; min-width: 0; border-radius: 8px; }
.chat-list-row.current { background: var(--color-selection); font-weight: 500; }
.chat-list-open { flex: 1; min-width: 0; justify-content: flex-start; min-height: 40px; padding-inline: 9px 4px; border-radius: 8px; font-size: 13px; }
.chat-list-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-list-pin { flex: none; color: var(--color-primary); }
.chat-list-menu { flex: none; width: 34px; min-height: 40px; padding-inline: 0; color: var(--color-text-muted); }
:deep(.ant-dropdown-menu-title-content) { display: flex; align-items: center; gap: 8px; }
@media (max-width: 767px) {
  .new-chat, .chat-list-open, .chat-list-menu, :deep(.ant-input-affix-wrapper) { min-height: 44px; }
  .chat-list-menu { width: 44px; }
}
</style>
