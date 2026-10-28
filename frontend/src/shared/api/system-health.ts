export type SystemHealth = 'UP' | 'DOWN' | 'OUT_OF_SERVICE' | 'UNKNOWN'

/** Reads aggregate readiness only; the API deliberately does not expose infrastructure details. */
export async function readSystemHealth(signal: AbortSignal): Promise<SystemHealth> {
  const response = await fetch('/api/system/health/readiness', {
    signal,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (response.status !== 200 && response.status !== 503) {
    throw new Error('健康检查请求失败，请确认后端已启动后重试。')
  }
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !('status' in body)) {
    throw new Error('服务返回了无法识别的状态，请检查后端配置。')
  }
  if (response.ok && body.status === 'UP') return 'UP'
  if (response.status === 503 && (body.status === 'DOWN' || body.status === 'OUT_OF_SERVICE')) {
    return body.status
  }
  throw new Error('服务返回了不一致的状态，请检查后端配置。')
}
