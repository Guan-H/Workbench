import { api, ApiError, apiResponse } from '../../shared/api/client'

export interface Conversation {
  id: string
  title: string
  modelId: string
  revision: number
  updatedAt: string
  pinned: boolean
  providerId: string
}

export interface ChatTurn {
  id: string
  conversationId: string
  position: number
  prompt: string
  reply: string
  provider: string
  modelId: string
  actualModel: string | null
  status: 'generating' | 'complete' | 'truncated' | 'failed' | 'interrupted' | 'stopped'
  errorMessage: string | null
  elapsedMs: number | null
  totalTokens: number | null
  answerId: string
  version: number
  revision: number
  providerId: string
}

export interface ChatVersion { turnId: string; answerId: string; version: number }
export interface ChatDetail {
  conversation: Conversation
  turns: ChatTurn[]
  versions: ChatVersion[]
  activeAnswer: ChatTurn | null
}
export interface ChatSend {
  id: string
  revision: number
  modelId: string
  text: string
  providerId: string
  confirmedProviderId?: string
}
export type ChatRegenerate = Omit<ChatSend, 'text'>

const root = '/ai/conversations'
const path = (id: string) => `${root}/${encodeURIComponent(id)}`
const turnPath = (id: string, turn: string) => `${path(id)}/turns/${encodeURIComponent(turn)}`
const answerPath = (id: string, answer: string) => `${path(id)}/answers/${encodeURIComponent(answer)}`

export const listConversations = (page: number, query: string, signal: AbortSignal) =>
  api<Conversation[]>(`${root}?${new URLSearchParams({ page: String(page), query })}`, { signal })
export const createConversation = (signal: AbortSignal) => api<Conversation>(root, { method: 'POST', signal })
export const readConversation = (id: string, signal: AbortSignal) => api<ChatDetail>(path(id), { signal })
export const renameConversation = (id: string, title: string, revision: number, signal: AbortSignal) =>
  api<Conversation>(path(id) + '/title', { method: 'PUT', body: JSON.stringify({ title, revision }), signal })
export const pinConversation = (id: string, pinned: boolean, revision: number, signal: AbortSignal) =>
  api<Conversation>(path(id) + '/pin', { method: 'PUT', body: JSON.stringify({ pinned, revision }), signal })
export const deleteConversation = (id: string, revision: number, signal: AbortSignal) =>
  apiResponse(`${path(id)}?revision=${revision}`, { method: 'DELETE', signal })
export const readChatAnswer = (id: string, answer: string, signal: AbortSignal) => api<ChatTurn>(answerPath(id, answer), { signal })
export const stopChatTurn = (id: string, answer: string, signal: AbortSignal) =>
  api<ChatTurn>(answerPath(id, answer) + '/stop', { method: 'POST', signal })
export const sendChatTurn = (id: string, input: ChatSend, signal: AbortSignal) =>
  api<ChatTurn>(path(id) + '/turns', { method: 'POST', body: JSON.stringify(input), signal })
export const regenerateChatAnswer = (id: string, turn: string, input: ChatRegenerate, signal: AbortSignal) =>
  api<ChatTurn>(turnPath(id, turn) + '/regenerate', { method: 'POST', body: JSON.stringify(input), signal })
export const selectChatAnswer = (id: string, turn: string, answer: string, revision: number, signal: AbortSignal) =>
  api<ChatDetail>(`${turnPath(id, turn)}/selected-answer/${encodeURIComponent(answer)}`, {
    method: 'PUT', body: JSON.stringify({ revision }), signal,
  })

/** Subscribe to a saved generation. Reconnecting only reads its existing result. */
export async function streamChatTurn(id: string, answer: string, signal: AbortSignal, update: (turn: ChatTurn) => void) {
  const response = await apiResponse(answerPath(id, answer) + '/events', { signal })
  if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
    throw new Error('无法读取回复数据流。')
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let current: ChatTurn | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let dirty = false
  function flush() {
    clearTimeout(timer)
    timer = undefined
    if (dirty && current && !signal.aborted) update({ ...current })
    dirty = false
  }
  function changed() {
    dirty = true
    if (timer === undefined) timer = setTimeout(flush, 32)
  }
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      let end = buffer.indexOf('\n\n')
      while (end >= 0) {
        const frame = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const lines = frame.split('\n')
        const event = lines.find(line => line.startsWith('event: '))?.slice(7)
        const data = lines.find(line => line.startsWith('data: '))?.slice(6)
        if (event === 'deleted') {
          throw new ApiError(404, 'AI_CHAT_NOT_FOUND', '会话已删除。')
        } else if (data && event === 'snapshot') {
          current = JSON.parse(data) as ChatTurn
          changed()
          if (current.status !== 'generating') {
            flush()
            return
          }
        } else if (data && event === 'delta' && current) {
          const delta = JSON.parse(data) as { offset: number; text: string }
          if (delta.offset !== current.reply.length) throw new Error('回复片段位置变化，请重新读取。')
          current = { ...current, reply: current.reply + delta.text }
          changed()
        }
        end = buffer.indexOf('\n\n')
      }
    }
    flush()
    throw new Error('回复数据流已断开，请重新读取。')
  } finally {
    clearTimeout(timer)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
