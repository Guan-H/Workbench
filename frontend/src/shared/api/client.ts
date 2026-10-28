export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public operationId?: string) { super(message) }
}

let csrfToken = ''

export async function refreshCsrf() {
  const response = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new ApiError(response.status, 'CSRF_UNAVAILABLE', '无法连接账户服务，请检查后端后重试。')
  csrfToken = (await response.json() as { token: string }).token
}

export async function api<T>(path: string, options: RequestInit = {}, retryCsrf = true): Promise<T> {
  const headers = new Headers(options.headers)
  const writing = options.method && options.method !== 'GET'
  // Another tab or a rejected request can invalidate the cookie-backed token.
  // Resolve it immediately before each mutation rather than keeping an old login token.
  if (writing) await refreshCsrf()
  if (writing) headers.set('X-CSRF-TOKEN', csrfToken)
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`/api/v1${path}`, { ...options, headers, credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { code?: string; title?: string; operationId?: string }
    // A rejected CSRF request has not reached the business handler. Retry once
    // with a fresh token, retaining the original idempotency key and payload.
    if (writing && retryCsrf && response.status === 403 && error.code === 'FORBIDDEN') return api<T>(path, options, false)
    throw new ApiError(response.status, error.code ?? 'REQUEST_FAILED', error.title ?? '请求失败，请稍后重试。', error.operationId)
  }
  return await response.json() as T
}

export function write<T>(path: string, method: string, body?: unknown, operation: string = crypto.randomUUID()): Promise<T> {
  return api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Idempotency-Key': operation } })
}

export interface AuthStatus { initialized: boolean; authenticated: boolean; username: string | null }
export interface Note {
  id: string; path: string; type: 'note' | 'folder' | 'attachment'; version: string; content: string | null
  deleted: boolean; favorite: boolean; lastOpenedAt: string | null; updatedAt: string; size: number; sha256: string | null
}
export interface Revision { version: string; deleted: boolean; createdAt: string }
export interface MovePreview {
  fingerprint: string; fromPath: string; toPath: string; warnings: string[]
  changes: { id: string; fromPath: string; toPath: string; baseVersion: string; links: { line: number; from: string; to: string }[] }[]
}

export async function listNotes(deleted = false, query = ''): Promise<Note[]> {
  const items: Note[] = []
  let cursor: string | null = ''
  do {
    const page: { items: Note[]; nextCursor: string | null } = await api(`/notes?deleted=${deleted}&cursor=${cursor}&query=${encodeURIComponent(query)}`)
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return items
}
