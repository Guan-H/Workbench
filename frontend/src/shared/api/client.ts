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

export interface UploadProgress { loaded: number; total: number | null; transferred: boolean }

/** Reports real request-body bytes for the complete batch; upload completion is not server confirmation. */
export async function uploadRequest<T>(path: string, body: FormData | string, progress: (value: UploadProgress) => void,
  headers: Record<string, string> = {}, retryCsrf = true): Promise<T> {
  progress({ loaded: 0, total: null, transferred: false })
  await refreshCsrf()
  try {
    return await new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/v1' + path)
      xhr.setRequestHeader('X-CSRF-TOKEN', csrfToken)
      if (typeof body === 'string') xhr.setRequestHeader('Content-Type', 'application/json')
      Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value))
      let last: UploadProgress = { loaded: 0, total: null, transferred: false }
      xhr.upload.onprogress = event => {
        last = { loaded: event.loaded, total: event.lengthComputable ? event.total : null, transferred: false }
        progress(last)
      }
      xhr.upload.onload = () => progress({ ...last, transferred: true })
      xhr.onerror = () => reject(new TypeError('Failed to fetch'))
      xhr.onabort = () => reject(new TypeError('Upload connection aborted'))
      xhr.onload = () => {
        let result: { code?: string; title?: string; operationId?: string }
        try { result = JSON.parse(xhr.responseText) }
        catch { reject(new ApiError(xhr.status, 'INVALID_RESPONSE', '服务器响应无法确认，请保留内容后重试。')); return }
        if (xhr.status >= 200 && xhr.status < 300) resolve(result as T)
        else reject(new ApiError(xhr.status, result.code ?? 'REQUEST_FAILED', result.title ?? '上传失败，请重试。', result.operationId))
      }
      xhr.send(body)
    })
  } catch (cause) {
    if (retryCsrf && cause instanceof ApiError && cause.status === 403 && cause.code === 'FORBIDDEN') return uploadRequest(path, body, progress, headers, false)
    throw cause
  }
}

export interface AuthStatus { initialized: boolean; authenticated: boolean; username: string | null }
export interface Note {
  id: string; path: string; type: 'note' | 'folder' | 'attachment'; version: string; content: string | null
  deleted: boolean; favorite: boolean; lastOpenedAt: string | null; updatedAt: string; size: number; sha256: string | null
}
export interface Revision { version: string; deleted: boolean; createdAt: string }
export interface RevisionPage { items: Revision[]; nextCursor: string | null }
export type TreeItem = Pick<Note, 'id' | 'path' | 'type'>
export interface RecycleCandidates { id: string; path: string; baseVersion: string; items: TreeItem[] }
export interface RecycleRequest { baseVersion: string; mode: 'all' | 'files'; ids: string[]; destination: 'original' | 'directory'; target: string; fingerprint?: string }
export interface RecyclePreview { fingerprint: string; changes: { id: string; fromPath: string; toPath: string; type: string; links: { line: number; from: string; to: string }[] }[]; folders: { path: string; action: 'CREATE' | 'RESTORE' | 'REUSE' }[]; warnings: string[] }
export interface RecycleResult { filesRestored: number; foldersRestored: number; ids: string[] }
export interface DeletePreview { fingerprint: string; targets: { id: string; path: string; type: Note['type']; version: string }[] }
export interface ImportLimits { maxFiles: number; maxBytes: number; maxNoteBytes: number; maxAttachmentBytes: number }
export interface ImportPreview {
  fingerprint: string; canImport: boolean; totalBytes: number; fileCount: number
  entries: { path: string; type: 'note' | 'folder' | 'attachment'; size: number; status: 'CREATE' | 'REUSE' | 'BLOCKED'; message: string }[]
}
export interface ImportResult { filesCreated: number; foldersCreated: number; totalBytes: number }
export interface MovePreview {
  fingerprint: string; fromPath: string; toPath: string; warnings: string[]
  changes: { id: string; fromPath: string; toPath: string; baseVersion: string; links: { line: number; from: string; to: string }[] }[]
}

export async function listNotes(deleted = false, query = ''): Promise<Note[]> {
  const items: Note[] = []
  let cursor: string | null = ''
  do {
    const page: { items: Note[]; nextCursor: string | null } = await api(`/notes?deleted=${deleted}&includeGroups=${deleted}&cursor=${cursor}&query=${encodeURIComponent(query)}`)
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return items
}
