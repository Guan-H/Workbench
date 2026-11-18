import { api, apiResponse } from '../../shared/api/client'

export interface AiModel { modelId: string; name: string }
export interface AiSettings {
  revision: number
  providerName: string
  baseUrl: string
  models: AiModel[]
  keyConfigured: boolean
  encryptionReady: boolean
  providerId: string
  providerLabel: string
}
export interface AiResult {
  provider: string
  model: string
  text: string
  finishReason: string
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null
  elapsedMs: number
}
type SettingsInput = Pick<AiSettings, 'revision' | 'providerName' | 'models'> & { apiKey?: string }
type ProbeInput = { modelId: string; text: string; providerId: string }

export function readAiProviders(signal: AbortSignal) {
  return api<AiSettings[]>('/ai/providers', { signal })
}

export function discoverAiModels(providerId: string, signal: AbortSignal) {
  return api<AiModel[]>('/ai/models?provider=' + encodeURIComponent(providerId), { signal })
}

export function saveAiSettings(providerId: string, value: SettingsInput, signal: AbortSignal) {
  return api<AiSettings>('/ai/settings?provider=' + encodeURIComponent(providerId), { method: 'PUT', body: JSON.stringify(value), signal })
}

export async function probeAi(value: ProbeInput, stream: boolean, signal: AbortSignal, append: (text: string) => void) {
  const options = { method: 'POST', body: JSON.stringify(value), signal }
  if (!stream) return api<AiResult>('/ai/probe', options)
  const response = await apiResponse('/ai/probe/stream', options)
  if (!response.body || !response.headers.get('Content-Type')?.startsWith('text/event-stream')) {
    throw new Error('无法读取流式响应。')
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let pending = ''
  try {
    for (;;) {
      const { value: chunk, done } = await reader.read()
      if (done) throw new Error('流式回复提前中断。')
      pending += chunk
      let end = pending.indexOf('\n\n')
      while (end >= 0) {
        const frame = pending.slice(0, end)
        pending = pending.slice(end + 2)
        const [event, data] = frame.split('\n', 2)
        if (data?.startsWith('data: ')) {
          const value = JSON.parse(data.slice(6))
          if (event === 'event: delta') append(value.text)
          if (event === 'event: error') throw new Error(value.message)
          if (event === 'event: done') return value as AiResult
        }
        end = pending.indexOf('\n\n')
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
