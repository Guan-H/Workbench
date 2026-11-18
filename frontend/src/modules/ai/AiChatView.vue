<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Drawer as ADrawer, Input as AInput, Select as ASelect, Textarea as ATextarea, message } from 'ant-design-vue'
import { ArrowUp, Bot, ChevronLeft, ChevronRight, Copy, Menu, PanelLeft, Plus, RefreshCw, Square } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ApiError } from '../../shared/api/client'
import AppDialog from '../../shared/AppDialog.vue'
import ConfirmDialog from '../../shared/ConfirmDialog.vue'
import { readAiProviders, type AiSettings } from './ai-api'
import { createConversation, listConversations, readConversation, streamChatTurn, sendChatTurn, stopChatTurn,
  readChatAnswer, regenerateChatAnswer, selectChatAnswer, renameConversation, pinConversation, deleteConversation,
  type ChatDetail, type ChatRegenerate, type ChatSend, type ChatTurn, type ChatVersion, type Conversation } from './chat-api'
import AiChatReply from './AiChatReply.vue'
import AiConversationList from './AiConversationList.vue'

const props = defineProps<{ username: string; navigationOpen: boolean }>()
const emit = defineEmits<{ settings: []; toggleNavigation: [] }>()
const remembered = `workbench-ai-chat:${props.username}`
const controller = new AbortController()
const providers = ref<AiSettings[]>([])
const conversations = ref<Conversation[]>([])
const query = ref('')
const listError = ref('')
const [messages, MessageHolder] = message.useMessage()
const detail = ref<ChatDetail>()
const model = ref('')
const draft = ref('')
const loading = ref(true)
const busy = ref(false)
const listLoading = ref(false)
const drawer = ref(false)
const historyOpen = ref(true)
const error = ref('')
const pollError = ref('')
const notice = ref('')
const page = ref(1)
const hasMore = ref(false)
const scroll = ref<HTMLElement>()
const pending = ref<ChatSend>()
const pendingRegeneration = ref<{ turnId: string; request: ChatRegenerate }>()
const disclosure = ref<{ destination: AiSettings; conversationId: string; revision: number; turnId?: string }>()
const viewed = ref<Record<string, ChatTurn>>({})
const versionReading = ref(false)
const managing = ref<{ kind: 'rename' | 'delete'; chat: Conversation }>()
const newTitle = ref('')
const managementError = ref('')
let listRequest: AbortController | undefined
let searchDelay: ReturnType<typeof setTimeout> | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let replyStream: AbortController | undefined

const latest = computed(() => detail.value?.turns.at(-1))
const activeAnswer = computed(() => detail.value?.activeAnswer)
const generating = computed(() => !!activeAnswer.value)
const pendingWrite = computed(() => !!pending.value || !!pendingRegeneration.value)
const listDisabled = computed(() => loading.value || busy.value || pendingWrite.value || versionReading.value || !!managing.value)
const dialogTitle = computed(() => managing.value?.kind === 'rename' ? '重命名会话' : '永久删除会话')
const turnVersions = computed(() => {
  const grouped = new Map<string, ChatVersion[]>()
  for (const version of detail.value?.versions ?? []) {
    const items = grouped.get(version.turnId) ?? []
    items.push(version)
    grouped.set(version.turnId, items)
  }
  return grouped
})
const displayedTurns = computed(() => detail.value?.turns.map(selected => {
  const active = activeAnswer.value
  const saved = viewed.value[selected.id]
  const turn = active?.id === selected.id ? active : saved ?? selected
  const versions = turnVersions.value.get(turn.id) ?? []
  return { turn, selected, versions }
}) ?? [])
const modelKey = (providerId: string, modelId: string) => providerId + ':' + modelId
const availableProviders = computed(() => providers.value.filter(item => item.keyConfigured && item.encryptionReady && item.models.length))
const providerOptions = computed(() => availableProviders.value.map(provider => ({
  label: provider.providerName, value: provider.providerId,
})))
const models = computed(() => availableProviders.value.flatMap(provider =>
  provider.models.map(item => ({
    provider, modelId: item.modelId, label: item.name,
    value: modelKey(provider.providerId, item.modelId),
  })),
))
const selectedModel = computed(() => models.value.find(item => item.value === model.value))
const selectedProviderId = computed(() => selectedModel.value?.provider.providerId)
const providerModels = computed(() => models.value.filter(item => item.provider.providerId === selectedProviderId.value))
const ready = computed(() => models.value.length > 0)
const routingLocked = computed(() => busy.value || generating.value || pendingWrite.value)
const disclosureText = computed(() => {
  const request = disclosure.value
  if (!request) return ''
  const target = request.destination
  const content = request.turnId
    ? '本轮原问题，以及更早的提问和已采用回答'
    : '这条消息，以及当前会话此前的提问和已采用回答'
  const router = target.providerId === 'openrouter' ? ' OpenRouter 可能将请求转发给其上游模型提供商。' : ''
  return `继续会把${content}发送给 ${target.providerLabel}（${new URL(target.baseUrl).hostname}）。${router}`
})
const statuses: Record<ChatTurn['status'], string> = {
  generating: '正在生成', complete: '已完成', truncated: '达到输出上限', failed: '生成失败', interrupted: '已中断', stopped: '已停止',
}

function describe(cause: unknown) {
  return cause instanceof ApiError ? cause.message : '连接中断，请刷新会话核对后重试。'
}

function remember(id?: string | null) {
  try {
    if (id === null) sessionStorage.removeItem(remembered)
    else if (id) sessionStorage.setItem(remembered, id)
    else return sessionStorage.getItem(remembered)
  } catch { return null }
}

async function loadList(append = false) {
  if (controller.signal.aborted || (append && listLoading.value)) return
  clearTimeout(searchDelay)
  listRequest?.abort()
  const request = new AbortController()
  listRequest = request
  const search = query.value.trim()
  listLoading.value = true
  listError.value = ''
  const next = append ? page.value + 1 : 1
  try {
    const rows = await listConversations(next, search, request.signal)
    if (request.signal.aborted) return
    conversations.value = append ? [...new Map([...conversations.value, ...rows].map(row => [row.id, row])).values()] : rows
    page.value = next
    hasMore.value = rows.length === 30
  } catch (cause) {
    if (!request.signal.aborted) listError.value = describe(cause)
  } finally { if (!request.signal.aborted) listLoading.value = false }
}

watch(() => query.value.trim(), () => {
  clearTimeout(searchDelay)
  listRequest?.abort()
  listLoading.value = true
  listError.value = ''
  conversations.value = []
  hasMore.value = false
  searchDelay = setTimeout(() => { void loadList() }, 250)
})

function clearChat(id: string) {
  if (detail.value?.conversation.id !== id) return
  replyStream?.abort()
  clearTimeout(timer)
  remember(null)
  detail.value = undefined
  viewed.value = {}
  draft.value = ''
  notice.value = ''
  pollError.value = ''
  pending.value = undefined
  pendingRegeneration.value = undefined
}

function startManagement(kind: 'rename' | 'delete', chat: Conversation) {
  if (listDisabled.value) return
  const current = detail.value?.conversation
  const target = current?.id === chat.id && current.revision >= chat.revision ? current : chat
  managing.value = { kind, chat: { ...target } }
  newTitle.value = target.title
  managementError.value = ''
}

async function managementConflict(cause: unknown, id: string) {
  if (!(cause instanceof ApiError) || (cause.status !== 409 && cause.status !== 404)) return false
  managing.value = undefined
  if (cause.status === 404) clearChat(id)
  else if (detail.value?.conversation.id === id) {
    try { apply(await readConversation(id, controller.signal)) } catch { /* The list can still be refreshed. */ }
  }
  messages.warning(describe(cause), 2)
  void loadList()
  return true
}

async function pinChat(chat: Conversation) {
  if (listDisabled.value) return
  busy.value = true
  const current = detail.value?.conversation
  const target = current?.id === chat.id && current.revision >= chat.revision ? current : chat
  try {
    const changed = await pinConversation(target.id, !target.pinned, target.revision, controller.signal)
    if (detail.value?.conversation.id === changed.id) detail.value.conversation = changed
    messages.success(changed.pinned ? '会话已置顶' : '已取消置顶', 2)
    void loadList()
  } catch (cause) {
    if (!controller.signal.aborted && !await managementConflict(cause, target.id)) messages.error(describe(cause), 2)
  } finally { busy.value = false }
}

async function submitManagement() {
  const operation = managing.value
  if (!operation || busy.value || (operation.kind === 'rename' && !newTitle.value.trim())) return
  busy.value = true
  managementError.value = ''
  try {
    const { id, revision } = operation.chat
    if (operation.kind === 'rename') {
      const changed = await renameConversation(id, newTitle.value.trim(), revision, controller.signal)
      if (detail.value?.conversation.id === id) detail.value.conversation = changed
      messages.success('会话已重命名', 2)
    } else {
      await deleteConversation(id, revision, controller.signal)
      clearChat(id)
      messages.success('会话已删除', 2)
    }
    managing.value = undefined
    void loadList()
  } catch (cause) {
    if (!controller.signal.aborted && !await managementConflict(cause, operation.chat.id)) managementError.value = describe(cause)
  } finally { busy.value = false }
}

function apply(value: ChatDetail) {
  const previousId = detail.value?.conversation.id
  detail.value = value
  if (previousId !== value.conversation.id) viewed.value = {}
  const chosen = modelKey(value.conversation.providerId, value.conversation.modelId)
  if (previousId !== value.conversation.id || !selectedModel.value) {
    model.value = models.value.find(item => item.value === chosen)?.value
      ?? models.value.find(item => item.provider.providerId === value.conversation.providerId)?.value
      ?? models.value[0]?.value ?? ''
  }
  remember(value.conversation.id)
  schedule()
  if (previousId !== value.conversation.id) {
    void nextTick(() => {
      if (scroll.value) scroll.value.scrollTop = scroll.value.scrollHeight
    })
  }
}

function chooseProvider(id: unknown) {
  if (typeof id !== 'string' || id === selectedProviderId.value || routingLocked.value) return
  const options = models.value.filter(item => item.provider.providerId === id)
  const last = detail.value?.conversation
  const preferred = last?.providerId === id ? options.find(item => item.modelId === last.modelId) : undefined
  const next = preferred ?? options[0]
  if (next) model.value = next.value
}

async function init() {
  loading.value = true
  error.value = ''
  try {
    providers.value = await readAiProviders(controller.signal)
    await loadList()
    const id = remember() || conversations.value[0]?.id
    if (!id) return
    try { apply(await readConversation(id, controller.signal)) }
    catch (cause) {
      if (!(cause instanceof ApiError) || cause.status !== 404) throw cause
      const first = conversations.value[0]?.id
      if (first && first !== id) apply(await readConversation(first, controller.signal))
    }
  } catch (cause) {
    if (!controller.signal.aborted) error.value = describe(cause)
  } finally { loading.value = false }
}

async function openChat(id?: string) {
  if (busy.value || pendingWrite.value || versionReading.value) return
  busy.value = true
  error.value = ''
  try {
    const value = id ? await readConversation(id, controller.signal) : {
      conversation: await createConversation(controller.signal), turns: [], versions: [], activeAnswer: null,
    }
    draft.value = ''
    notice.value = ''
    pollError.value = ''
    apply(value)
    drawer.value = false
    if (!id) void loadList()
  } catch (cause) {
    if (!controller.signal.aborted) error.value = describe(cause)
  } finally { busy.value = false }
}

function schedule(delay = 0) {
  clearTimeout(timer)
  replyStream?.abort()
  const active = activeAnswer.value
  if (active && !controller.signal.aborted) {
    timer = setTimeout(() => { void poll(active) }, delay)
  }
}

async function poll(active: ChatTurn) {
  const stream = new AbortController()
  replyStream = stream
  const abort = () => stream.abort()
  controller.signal.addEventListener('abort', abort, { once: true })
  try {
    await streamChatTurn(active.conversationId, active.answerId, stream.signal, update => {
      if (activeAnswer.value?.answerId !== active.answerId) return
      replaceAnswer(update)
      pollError.value = ''
    })
  } catch (cause) {
    if (stream.signal.aborted || activeAnswer.value?.answerId !== active.answerId) return
    if (cause instanceof ApiError && cause.status === 404) {
      clearChat(active.conversationId)
      if (managing.value?.kind !== 'delete' || managing.value.chat.id !== active.conversationId) {
        messages.info('会话已删除', 2)
      }
      void loadList()
      return
    }
    pollError.value = describe(cause)
  } finally {
    controller.signal.removeEventListener('abort', abort)
  }
  if (!stream.signal.aborted && activeAnswer.value?.answerId === active.answerId) schedule(1200)
}

function replaceAnswer(turn: ChatTurn) {
  const value = detail.value
  if (!value || value.conversation.id !== turn.conversationId) return
  const index = value.turns.findIndex(item => item.id === turn.id)
  if (value.turns[index]?.answerId === turn.answerId) value.turns[index] = turn
  else viewed.value[turn.id] = turn
  value.activeAnswer = turn.status === 'generating' ? turn : null
}

function recordAnswer(value: ChatDetail, turn: ChatTurn) {
  if (!value.versions.some(item => item.answerId === turn.answerId)) {
    value.versions.push({ turnId: turn.id, answerId: turn.answerId, version: turn.version })
  }
  value.conversation.revision = turn.revision
  value.conversation.modelId = turn.modelId
  value.conversation.providerId = turn.providerId
  replaceAnswer(turn)
  pollError.value = ''
  schedule()
  void loadList()
}

function needsDisclosure(chat: ChatDetail, target: AiSettings, confirmed?: string, turnId?: string) {
  if (!chat.turns.length || confirmed === target.providerId) return false
  if (chat.conversation.providerId === target.providerId && chat.turns.every(turn => turn.providerId === target.providerId)) return false
  disclosure.value = { destination: target, conversationId: chat.conversation.id, revision: chat.conversation.revision, turnId }
  return true
}

function confirmDisclosure(accepted: boolean) {
  const request = disclosure.value
  disclosure.value = undefined
  if (!accepted || !request) return
  if (detail.value?.conversation.id !== request.conversationId || detail.value.conversation.revision !== request.revision
      || selectedModel.value?.provider.providerId !== request.destination.providerId) {
    error.value = '会话或服务商已变化，请重新确认。'
    return
  }
  if (request.turnId) void regenerate(request.turnId, request.destination.providerId)
  else void send(request.destination.providerId)
}

async function send(confirmedProviderId?: string) {
  const active = detail.value
  const chosen = selectedModel.value
  if (!active || busy.value || generating.value || pendingRegeneration.value || versionReading.value
      || !chosen || !draft.value.trim()) return
  if (!pending.value) {
    if (needsDisclosure(active, chosen.provider, confirmedProviderId)) return
    pending.value = {
      id: crypto.randomUUID(), revision: active.conversation.revision, modelId: chosen.modelId, text: draft.value,
      providerId: chosen.provider.providerId, confirmedProviderId,
    }
  }
  const request = pending.value
  busy.value = true
  notice.value = ''
  error.value = ''
  try {
    const turn = await sendChatTurn(active.conversation.id, request, controller.signal)
    if (turn.revision !== request.revision + 1) apply(await readConversation(active.conversation.id, controller.signal))
    else {
      if (!active.turns.some(item => item.id === turn.id)) active.turns.push(turn)
      recordAnswer(active, turn)
    }
    pending.value = undefined
    draft.value = ''
  } catch (cause) {
    if (controller.signal.aborted) return
    if (cause instanceof ApiError && cause.status < 500) pending.value = undefined
    if (cause instanceof ApiError && cause.status === 409) {
      try { apply(await readConversation(active.conversation.id, controller.signal)) } catch { /* Keep the current draft. */ }
    }
    error.value = pending.value ? '发送结果尚未确认。可以重新读取会话，或重试同一条消息。' : describe(cause)
  } finally { busy.value = false }
}

async function refresh() {
  const id = detail.value?.conversation.id
  if (!id) return init()
  busy.value = true
  error.value = ''
  try {
    const value = await readConversation(id, controller.signal)
    if (pending.value && value.turns.some(turn => turn.id === pending.value?.id)) {
      pending.value = undefined
      draft.value = ''
    }
    const retry = pendingRegeneration.value?.request
    if (retry && value.versions.some(item => item.answerId === retry.id)) {
      pendingRegeneration.value = undefined
      if (value.activeAnswer?.answerId !== retry.id) {
        const answer = await readChatAnswer(id, retry.id, controller.signal)
        viewed.value[answer.id] = answer
      }
    } else if (retry && value.conversation.revision !== retry.revision) {
      pendingRegeneration.value = undefined
      error.value = '会话已更新，原重新生成请求未写入。'
    }
    apply(value)
    pollError.value = ''
    void loadList()
  } catch (cause) {
    if (!controller.signal.aborted) {
      if (cause instanceof ApiError && cause.status === 404) {
        clearChat(id)
        void loadList()
      }
      error.value = describe(cause)
    }
  } finally { busy.value = false }
}

async function stop() {
  const active = activeAnswer.value
  if (!active || busy.value) return
  busy.value = true
  error.value = ''
  try {
    replaceAnswer(await stopChatTurn(active.conversationId, active.answerId, controller.signal))
    pollError.value = ''
    schedule()
  } catch (cause) {
    if (!controller.signal.aborted) error.value = describe(cause)
  } finally { busy.value = false }
}

async function regenerate(turnId: string, confirmedProviderId?: string) {
  const value = detail.value
  const chosen = selectedModel.value
  if (!value || latest.value?.id !== turnId || busy.value || generating.value || pending.value || versionReading.value
      || !chosen) return
  if (!pendingRegeneration.value && needsDisclosure(value, chosen.provider, confirmedProviderId, turnId)) return
  const request = pendingRegeneration.value?.request ?? {
    id: crypto.randomUUID(), revision: value.conversation.revision, modelId: chosen.modelId,
    providerId: chosen.provider.providerId, confirmedProviderId,
  }
  pendingRegeneration.value = { turnId, request }
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const turn = await regenerateChatAnswer(value.conversation.id, turnId, request, controller.signal)
    if (turn.revision !== request.revision + 1) {
      apply(await readConversation(value.conversation.id, controller.signal))
      if (turn.status !== 'generating') viewed.value[turn.id] = turn
    } else recordAnswer(value, turn)
    pendingRegeneration.value = undefined
  } catch (cause) {
    if (controller.signal.aborted) return
    if (cause instanceof ApiError && cause.status < 500) pendingRegeneration.value = undefined
    if (cause instanceof ApiError && cause.status === 409) {
      try { apply(await readConversation(value.conversation.id, controller.signal)) } catch { /* Keep the current view. */ }
    }
    error.value = pendingRegeneration.value ? '重新生成的结果尚未确认。可以刷新会话，或重试原请求。' : describe(cause)
  } finally { busy.value = false }
}

async function viewVersion(selected: ChatTurn, target?: ChatVersion) {
  if (!target || busy.value || versionReading.value) return
  if (target.answerId === selected.answerId) {
    delete viewed.value[selected.id]
    return
  }
  versionReading.value = true
  error.value = ''
  try {
    viewed.value[selected.id] = await readChatAnswer(selected.conversationId, target.answerId, controller.signal)
  } catch (cause) {
    if (!controller.signal.aborted) error.value = describe(cause)
  } finally { versionReading.value = false }
}

async function useAnswer(turn: ChatTurn) {
  const value = detail.value
  if (!value || busy.value || generating.value || pendingWrite.value || versionReading.value || latest.value?.id !== turn.id) return
  busy.value = true
  notice.value = ''
  error.value = ''
  try {
    detail.value = await selectChatAnswer(turn.conversationId, turn.id, turn.answerId, value.conversation.revision, controller.signal)
    delete viewed.value[turn.id]
    notice.value = `第 ${turn.version} 版将用于后续对话`
    void loadList()
  } catch (cause) {
    if (controller.signal.aborted) return
    if (cause instanceof ApiError && cause.status === 409) {
      try { apply(await readConversation(turn.conversationId, controller.signal)) } catch { /* Keep the current view. */ }
    }
    error.value = describe(cause)
  } finally { busy.value = false }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    notice.value = '已复制回复'
  } catch { notice.value = '无法访问剪贴板，请手动选择文字复制。' }
}

function composerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey
      || event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  void send()
}

watch(() => [detail.value?.conversation.id, latest.value?.id, activeAnswer.value?.reply], async () => {
  const element = scroll.value
  const nearEnd = !element || element.scrollHeight - element.scrollTop - element.clientHeight < 180
  await nextTick()
  if (nearEnd && scroll.value) scroll.value.scrollTop = scroll.value.scrollHeight
})
onMounted(() => { void init() })
onBeforeUnmount(() => {
  clearTimeout(timer)
  clearTimeout(searchDelay)
  listRequest?.abort()
  replyStream?.abort()
  controller.abort()
})
</script>

<template>
  <div class="ai-chat">
    <MessageHolder />
    <div class="workspace-panel-viewport desktop-history-viewport" :class="{ 'is-collapsed': !historyOpen }" :inert="!historyOpen">
      <aside id="ai-chat-history" class="workspace-panel-card ai-history ai-history-card desktop-history" aria-label="会话列表">
        <header><h2>历史会话</h2></header>
        <AiConversationList v-model:query="query" :chats="conversations" :selected="detail?.conversation.id"
          :pending="listLoading" :disabled="listDisabled" :has-more="hasMore" :list-error="listError"
          @open="openChat" @rename="startManagement('rename', $event)" @pin="pinChat"
          @remove="startManagement('delete', $event)" @more="loadList(true)" @retry="loadList()" />
      </aside>
    </div>
    <ADrawer v-model:open="drawer" title="会话" placement="left" :width="280">
      <div class="ai-history ai-history-card drawer-history">
        <AiConversationList v-model:query="query" :chats="conversations" :selected="detail?.conversation.id"
          :pending="listLoading" :disabled="listDisabled" :has-more="hasMore" :list-error="listError"
          @open="openChat" @rename="startManagement('rename', $event)" @pin="pinChat"
          @remove="startManagement('delete', $event)" @more="loadList(true)" @retry="loadList()" />
      </div>
    </ADrawer>
    <section class="ai-conversation" aria-label="AI 聊天">
      <header class="ai-chat-header">
        <h1 class="sr-only">AI 聊天</h1>
        <AButton type="text" class="chat-workspace-menu" aria-label="显示导航" :aria-expanded="navigationOpen"
          @click="emit('toggleNavigation')"><Menu :size="20" aria-hidden="true" /></AButton>
        <AButton type="text" class="chat-history-toggle" :aria-label="historyOpen ? '收起会话列表' : '展开会话列表'"
          :title="historyOpen ? '收起会话列表' : '展开会话列表'" :aria-expanded="historyOpen" aria-controls="ai-chat-history" @click="historyOpen = !historyOpen"><PanelLeft :size="19" aria-hidden="true" /></AButton>
        <AButton type="text" class="chat-drawer-button" aria-label="打开会话列表" @click="drawer = true"><PanelLeft :size="18" aria-hidden="true" /></AButton>
        <span class="chat-heading-spacer" />
        <AButton type="text" aria-label="新建会话" title="新建会话" :disabled="loading || busy || pendingWrite || versionReading" @click="openChat()"><Plus :size="19" aria-hidden="true" /></AButton>
        <AButton type="text" aria-label="重新读取会话" title="重新读取会话" :disabled="busy || loading || versionReading" @click="refresh"><RefreshCw :size="16" aria-hidden="true" /></AButton>
      </header>
      <AAlert v-if="error" class="chat-alert" type="error" show-icon :message="error" />
      <AAlert v-if="pollError" class="chat-alert" type="warning" show-icon :message="pollError" />
      <div ref="scroll" class="ai-transcript" aria-label="聊天记录" tabindex="0">
        <p v-if="loading" class="ai-empty" role="status">正在读取会话…</p>
        <div v-else-if="!detail?.turns.length" class="ai-empty">
          <span class="chat-empty-symbol"><Bot :size="30" aria-hidden="true" /></span>
          <h3>{{ ready ? '今天想聊些什么？' : '连接你的 AI 助手' }}</h3>
          <p>{{ ready ? (detail ? '从一个问题、一个想法开始。' : '新建一段会话，开始交流。') : '配置 AI 服务商的凭据和模型后开始对话。' }}</p>
          <AButton v-if="!ready" @click="emit('settings')">前往设置</AButton>
          <AButton v-else-if="!detail" type="primary" :loading="busy" @click="openChat()">新建会话</AButton>
        </div>
        <article v-for="{ turn, selected, versions } in displayedTurns" :key="turn.id" class="ai-turn">
          <p class="ai-prompt">{{ turn.prompt }}</p>
          <div class="ai-answer">
            <div class="ai-answer-heading">
              <span class="chat-answer-symbol"><Bot :size="16" aria-hidden="true" /></span><strong>{{ turn.provider }}</strong>
              <span>{{ turn.actualModel || '请求模型 ' + turn.modelId }}</span>
            </div>
            <AiChatReply v-if="turn.reply" :text="turn.reply" />
            <span v-else-if="turn.status === 'generating'" class="chat-thinking" aria-label="正在生成"><i /><i /><i /></span>
            <p v-if="turn.errorMessage" class="chat-error">{{ turn.errorMessage }}</p>
            <div class="chat-answer-actions">
              <AButton v-if="turn.reply" type="text" aria-label="复制回复" title="复制回复" @click="copy(turn.reply)"><Copy :size="15" aria-hidden="true" /></AButton>
              <AButton v-if="turn.id === latest?.id && ready && !generating && !pendingRegeneration" type="text"
                aria-label="重新生成" title="重新生成" :disabled="busy || pendingWrite || versionReading || !model"
                @click="regenerate(turn.id)"><RefreshCw :size="15" aria-hidden="true" /></AButton>
              <small class="ai-turn-status" :role="turn.id === latest?.id ? 'status' : undefined">{{ statuses[turn.status] }}</small>
              <details v-if="turn.status !== 'generating'" class="chat-generation-details">
                <summary>生成信息</summary><span>{{ turn.actualModel || '实际模型未知' }} · {{ turn.elapsedMs === null ? '耗时未知' : (turn.elapsedMs / 1000).toFixed(1) + ' 秒' }} · Token {{ turn.totalTokens ?? '未知' }}</span>
              </details>
            </div>
            <AButton v-if="pendingRegeneration?.turnId === turn.id" type="link" :loading="busy" @click="regenerate(turn.id)">重试原请求</AButton>
            <div v-if="versions.length > 1" class="chat-answer-versions" aria-label="回答版本" role="group">
              <div class="chat-version-navigation">
                <AButton type="text" aria-label="上一版回答" title="上一版回答"
                  :disabled="busy || versionReading || turn.status === 'generating' || turn.version <= 1"
                  @click="viewVersion(selected, versions[turn.version - 2])"><ChevronLeft :size="16" aria-hidden="true" /></AButton>
                <small role="status">{{ turn.version }} / {{ versions.length }}</small>
                <AButton type="text" aria-label="下一版回答" title="下一版回答"
                  :disabled="busy || versionReading || turn.status === 'generating' || turn.version >= versions.length"
                  @click="viewVersion(selected, versions[turn.version])"><ChevronRight :size="16" aria-hidden="true" /></AButton>
              </div>
              <small v-if="turn.answerId === selected.answerId">{{ turn.id === latest?.id ? '当前采用' : '历史采用' }}</small>
              <small v-else>{{ turn.id === latest?.id ? `当前采用第 ${selected.version} 版` : `仅查看 · 历史采用第 ${selected.version} 版` }}</small>
              <AButton v-if="turn.id === latest?.id && turn.answerId !== selected.answerId && turn.reply.trim() && ['complete', 'truncated'].includes(turn.status)"
                type="text" class="chat-use-answer" :disabled="busy || generating || pendingWrite || versionReading" @click="useAnswer(turn)">用于后续对话</AButton>
            </div>
          </div>
        </article>
      </div>
      <form v-if="detail && ready" class="ai-composer" @submit.prevent="send()">
        <div class="ai-composer-box">
          <ATextarea v-model:value="draft" aria-label="消息" placeholder="有什么想问的，写在这里…" :maxlength="8000"
            :auto-size="{ minRows: 2, maxRows: 6 }" :disabled="!!pending" @keydown="composerKeydown" />
          <div class="ai-composer-tools">
            <span class="chat-keyboard-hint">Enter 发送 · Shift + Enter 换行</span>
            <div class="chat-send-controls">
              <div class="chat-provider-control" @keydown.enter.prevent>
                <label class="chat-routing-label" for="ai-chat-provider">服务商</label>
                <ASelect id="ai-chat-provider" :value="selectedProviderId" class="chat-model-select" :options="providerOptions"
                  :disabled="routingLocked" :bordered="false" :dropdown-match-select-width="false" placement="topRight" @change="chooseProvider" />
              </div>
              <div class="chat-model-control" @keydown.enter.prevent>
                <label class="chat-routing-label" for="ai-chat-model">模型</label>
                <ASelect id="ai-chat-model" v-model:value="model" class="chat-model-select" :options="providerModels"
                  :disabled="routingLocked" :bordered="false" :dropdown-match-select-width="false" placement="topRight" />
              </div>
              <AButton v-if="generating" html-type="button" class="chat-send" aria-label="停止生成" title="停止生成" :loading="busy" @click="stop"><Square :size="16" aria-hidden="true" /></AButton>
              <AButton v-else class="chat-send" type="primary" html-type="submit" :aria-label="pending ? '重试原消息' : '发送'" :title="pending ? '重试原消息' : '发送'" :loading="busy" :disabled="!draft.trim() || !model || !!pendingRegeneration || versionReading"><ArrowUp :size="20" aria-hidden="true" /></AButton>
            </div>
          </div>
        </div>
        <span v-if="notice" class="chat-copy-notice" role="status">{{ notice }}</span>
      </form>
    </section>
    <ConfirmDialog v-if="disclosure" title="确认发送聊天历史" :message="disclosureText"
      confirm-label="确认并继续" @answer="confirmDisclosure" />
    <AppDialog v-if="managing" :label="dialogTitle" :width="420">
      <form class="modal chat-management-dialog" @submit.prevent="submitManagement">
        <header><h2>{{ dialogTitle }}</h2></header>
        <div class="chat-management-body">
          <template v-if="managing.kind === 'rename'">
            <label for="ai-new-title">会话标题</label>
            <AInput id="ai-new-title" v-model:value="newTitle" :maxlength="100" :disabled="busy" autofocus />
          </template>
          <p v-else>「{{ managing.chat.title }}」及其所有消息和回答版本将永久删除，不会进入回收站。正在生成的回复也会停止。</p>
          <p v-if="managementError" class="chat-error" role="alert">{{ managementError }}</p>
        </div>
        <footer>
          <AButton html-type="button" :disabled="busy" @click="managing = undefined">取消</AButton>
          <AButton type="primary" html-type="submit" :danger="managing.kind === 'delete'" :loading="busy"
            :disabled="managing.kind === 'rename' && !newTitle.trim()">{{ managing.kind === 'rename' ? '保存标题' : '永久删除' }}</AButton>
        </footer>
      </form>
    </AppDialog>
  </div>
</template>

<style scoped>
.ai-chat {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 12px;
  overflow: hidden;
}
.desktop-history-viewport { --panel-card-width: 220px; --panel-width: calc(var(--panel-card-width) + 12px); }
.ai-history { display: flex; flex-direction: column; min-width: 0; min-height: 0; gap: 12px; }
.ai-history-card {
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-background);
  box-shadow: 0 2px 8px var(--color-card-shadow);
}
.desktop-history { padding-top: 0; gap: 8px; }
.ai-history header, .ai-chat-header, .ai-answer-heading { display: flex; gap: 8px; align-items: center; }
.ai-history header { min-height: 48px; padding-inline: 10px; flex-shrink: 0; }
.ai-history h2 { margin: 0; font-size: 13px; font-weight: 500; color: var(--color-text-muted); }
.drawer-history { height: 100%; }
.chat-management-body { display: grid; gap: 8px; padding: 16px 24px; }
.chat-management-body p { margin: 0; overflow-wrap: anywhere; }
.chat-management-dialog > footer { padding: 0 24px 20px; }
.chat-management-dialog > footer .ant-btn { min-height: 44px; }
.ai-conversation {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 14px;
}
.ai-chat-header { flex-shrink: 0; min-height: 48px; padding: 4px 12px; gap: 8px; }
.ai-chat-header .ant-btn { min-height: 36px; width: 36px; padding: 6px; color: var(--color-text-muted); border-radius: 9px; }
.chat-heading-spacer { flex: 1; }
.chat-alert { margin: 6px 16px 0; flex-shrink: 0; }
.chat-drawer-button, .chat-workspace-menu { display: none; }
.ai-transcript { flex: 1; min-height: 0; overflow: auto; padding: 16px 32px; overscroll-behavior: contain; }
.ai-empty { display: grid; justify-items: center; align-content: center; min-height: 100%; padding-block: 30px; color: var(--color-text-muted); text-align: center; }
.chat-empty-symbol { display: grid; place-items: center; width: 62px; height: 62px; color: var(--color-primary); background: var(--color-accent-soft); border-radius: 20px; }
.ai-empty h3 { margin: 22px 0 0; font-size: clamp(24px, 3vw, 32px); font-weight: 500; letter-spacing: -.5px; color: var(--color-text); }
.ai-empty p { margin: 12px 0 22px; font-size: 14px; }
.ai-turn { max-width: 760px; margin: 0 auto 38px; }
.ai-prompt { margin: 0 0 26px auto; width: fit-content; max-width: min(85%, 580px); white-space: pre-wrap; overflow-wrap: anywhere; border-radius: 18px 18px 5px 18px; background: var(--color-selection); padding: 12px 18px; font-size: 15px; line-height: 1.75; }
.ai-answer { display: grid; gap: 14px; font-size: 15px; line-height: 1.8; }
.ai-answer-heading { flex-wrap: wrap; font-size: 12px; gap: 8px; }
.chat-answer-symbol { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; background: var(--color-accent-soft); color: var(--color-primary); }
.ai-answer-heading strong { font-weight: 600; }
.ai-answer-heading > span:last-child, .ai-turn-status { color: var(--color-text-muted); overflow-wrap: anywhere; }
.chat-answer-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; color: var(--color-text-muted); }
.chat-answer-actions .ant-btn { width: 32px; min-height: 32px; padding: 4px; color: inherit; border-radius: 8px; }
.chat-answer-versions, .chat-version-navigation { display: flex; align-items: center; gap: 6px; }
.chat-answer-versions { flex-wrap: wrap; margin-top: 6px; color: var(--color-text-muted); }
.chat-version-navigation .ant-btn { width: 32px; min-height: 32px; padding: 4px; }
.chat-version-navigation small { white-space: nowrap; font-variant-numeric: tabular-nums; }
.chat-use-answer { color: var(--color-primary); }
.chat-generation-details { font-size: 12px; }
.chat-generation-details summary { cursor: pointer; border-radius: 5px; }
.chat-generation-details span { display: block; margin-top: 6px; font-size: 12px; overflow-wrap: anywhere; }
.chat-error { margin: 0; color: var(--color-danger); }
.ai-composer { flex-shrink: 0; padding: 6px 32px 24px; background: var(--color-surface); }
.ai-composer-box { max-width: 760px; margin-inline: auto; padding: 12px 14px 10px; border: 1px solid var(--color-border); border-radius: 22px; background: var(--color-background); box-shadow: 0 3px 14px var(--color-card-shadow); transition: border-color 150ms ease, box-shadow 150ms ease; }
.ai-composer-box:focus-within { border-color: var(--color-primary); box-shadow: 0 0 0 2px var(--color-accent-soft); }
.ai-composer-box textarea { padding: 5px 4px; border: 0; box-shadow: none; background: transparent; font-size: 15px; line-height: 1.7; resize: none; }
.ai-composer-box textarea:focus { box-shadow: none; }
.ai-composer-tools { display: flex; align-items: center; gap: 10px; padding-top: 8px; }
.chat-keyboard-hint { color: var(--color-text-muted); font-size: 11px; }
.chat-send-controls { display: flex; align-items: flex-end; gap: 8px; min-width: 0; margin-left: auto; }
.chat-provider-control, .chat-model-control { display: grid; gap: 1px; min-width: 0; }
.chat-provider-control { width: 114px; }
.chat-model-control { width: 156px; }
.chat-routing-label { padding-inline: 11px 0; color: var(--color-text-muted); font-size: 11px; }
.chat-model-select { width: 100%; font-size: 13px; border-radius: 10px; }
.chat-model-select:not(.ant-select-disabled):hover { background: var(--color-selection); }
.chat-model-select :deep(.ant-select-selector) { background: transparent !important; }
.chat-model-select:focus-within { outline: 2px solid var(--color-primary); outline-offset: -2px; }
.ai-composer-tools .chat-send { flex: none; width: 38px; min-height: 38px; padding: 0; border-radius: 50%; }
.chat-copy-notice { display: block; max-width: 760px; margin: 8px auto 0; font-size: 12px; color: var(--color-text-muted); }
.chat-thinking { display: flex; gap: 5px; align-items: center; height: 22px; }
.chat-thinking i { width: 5px; height: 5px; border-radius: 50%; background: var(--color-text-muted); animation: chat-pulse 1200ms ease-in-out infinite; }
.chat-thinking i:nth-child(2) { animation-delay: 150ms; }
.chat-thinking i:nth-child(3) { animation-delay: 300ms; }
@keyframes chat-pulse { 50% { opacity: .3; transform: translateY(-2px); } }
@media (prefers-reduced-motion: reduce) { .chat-thinking i { animation: none; } .ai-composer-box { transition: none; } }
@media (max-width: 1100px) { .chat-keyboard-hint { display: none; } }
@media (max-width: 767px) {
  .ai-chat { padding: 0; }
  .desktop-history-viewport { display: none; }
  .chat-history-toggle { display: none; }
  .chat-drawer-button, .chat-workspace-menu { display: inline-flex; }
  .ai-conversation { border: 0; border-radius: 0; }
  .ai-chat-header { min-height: 56px; padding: 6px 8px; gap: 4px; }
  .ai-transcript { padding: 16px; }
  .ai-composer { padding: 6px 12px max(14px, env(safe-area-inset-bottom)); }
  .ai-composer-box { padding: 10px 12px; border-radius: 18px; }
  .ai-chat .ant-btn { min-height: 44px; }
  .ai-chat-header .ant-btn { width: 44px; }
  .chat-answer-actions .ant-btn, .chat-version-navigation .ant-btn { width: 44px; }
  .ai-composer-tools .chat-send { width: 44px; min-height: 44px; }
  .chat-model-select :deep(.ant-select-selector) { min-height: 44px; align-items: center; }
  .chat-send-controls { width: min(100%, 338px); }
  .chat-provider-control { flex: 2; width: auto; }
  .chat-model-control { flex: 3; width: auto; }
  .ai-prompt { max-width: 92%; }
  .ai-turn { margin-bottom: 28px; }
  .ai-empty h3 { font-size: 25px; }
}
</style>
