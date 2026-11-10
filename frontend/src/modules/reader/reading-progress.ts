import { api, write, ApiError } from '../../shared/api/client'
import type { Note } from '../../shared/api/client'
import { parseLocator, type ReadingLocator } from './book'

export interface ProgressResponse { revision: string; sourceHash: string | null; format: string | null; locator: string | null; operation: string | null; updatedAt: string | null }
interface Pending { operation: string; baseRevision: string; sourceVersion: string; sourceHash: string; format: string; locator: string }

/** A local write-ahead position is retried with its original operation and revision; it never rebases itself. */
export class ReadingProgress {
  private revision = '0'
  private pending?: Pending
  private current?: ReadingLocator
  private confirmed = ''
  private timer?: ReturnType<typeof setTimeout>
  private inflight?: Promise<void>
  private stopped = false
  conflict = false
  fileChanged = false
  readonly key: string

  constructor(private file: Note, username: string, private status: (message: string) => void) {
    if (!file.sha256) throw new Error('书籍缺少内容指纹，请刷新目录后重试。')
    this.key = `private-space:reading:${username}:${file.id}`
  }
  async open(): Promise<{ location?: ReadingLocator; previousLocation?: ReadingLocator; changed: boolean }> {
    const server = await api<ProgressResponse>(`/reader/files/${this.file.id}/progress`)
    this.revision = server.revision
    this.confirmed = server.sourceHash === this.file.sha256 ? server.locator || '' : ''
    let location = parseLocator(this.confirmed)
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) || 'null')
      const local = parseLocator(saved?.locator)
      if (saved?.hash === this.file.sha256 && local) {
        const candidate = saved.pending as Pending | undefined
        if (candidate && typeof candidate.operation === 'string' && candidate.sourceHash === this.file.sha256 && candidate.sourceVersion === this.file.version
          && typeof candidate.baseRevision === 'string' && parseLocator(candidate.locator) && candidate.format === this.format()) {
          if (candidate.operation === server.operation) { this.pending = undefined; this.revision = server.revision }
          else if (candidate.baseRevision === server.revision) this.pending = candidate
          else { this.conflict = true; this.status('其他页面已更新进度，本机位置保留，请选择采用哪一份。') }
        } else if (saved.dirty && saved.revision !== server.revision && saved.locator !== server.locator) {
          this.conflict = true; this.status('其他页面已更新进度，本机尚未提交的位置已保留。')
        } else if (saved.revision !== server.revision && saved.locator !== server.locator) {
          // Confirmed cache is not newer than a genuinely newer server position.
          return { location, changed: !!server.sourceHash && server.sourceHash !== this.file.sha256 }
        }
        location = local
        if (this.pending) this.status('本机有待确认阅读进度，将使用原操作重试。')
      }
    } catch { this.status('本机阅读记录无法读取，已使用服务器记录。') }
    this.current = location
    return { location, previousLocation: parseLocator(server.locator), changed: !!server.sourceHash && server.sourceHash !== this.file.sha256 }
  }
  private format() { return this.file.path.split('.').at(-1)!.toLowerCase() }
  private persist() {
    if (!this.current) return
    try { localStorage.setItem(this.key, JSON.stringify({ hash: this.file.sha256, revision: this.revision, locator: JSON.stringify(this.current), pending: this.pending, dirty: JSON.stringify(this.current) !== this.confirmed })) }
    catch { this.status('本机位置暂存失败，请保持联网并确认进度已保存。') }
  }
  record(location: ReadingLocator) {
    if (this.stopped) return
    this.current = location; this.persist()
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush() }, 1500)
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer)
    if (this.inflight) { await this.inflight; if (!this.stopped) await this.flush(); return }
    if (this.conflict || this.fileChanged || !this.current || (!this.pending && JSON.stringify(this.current) === this.confirmed)) return
    this.pending ||= { operation: crypto.randomUUID(), baseRevision: this.revision, sourceVersion: this.file.version,
      sourceHash: this.file.sha256!, format: this.format(), locator: JSON.stringify(this.current) }
    this.persist()
    const request = this.pending
    this.inflight = (async () => {
      try {
        const result = await write<ProgressResponse>(`/reader/files/${this.file.id}/progress`, 'PUT', {
          baseRevision: request.baseRevision, sourceVersion: request.sourceVersion, sourceHash: request.sourceHash, format: request.format, locator: request.locator,
        }, request.operation)
        this.revision = result.revision; this.confirmed = result.locator || ''; this.pending = undefined; this.persist()
        if (!this.stopped) this.status('阅读进度已保存')
      } catch (cause) {
        if (cause instanceof ApiError && cause.code === 'READING_PROGRESS_CHANGED') { this.conflict = true; this.status('其他页面已更新进度，本机位置保留，请核对。') }
        else if (cause instanceof ApiError && cause.code === 'READING_FILE_CHANGED') { this.fileChanged = true; this.status('书籍内容已变化，本机位置保留，请重新打开。') }
        else if (!this.stopped) this.status('进度尚未确认，已尝试暂存本机；联网后点击重试。')
      } finally { this.inflight = undefined }
    })()
    await this.inflight
    if (!this.stopped && !this.conflict && !this.fileChanged && !this.pending && JSON.stringify(this.current) !== this.confirmed) this.timer = setTimeout(() => { void this.flush() }, 1500)
  }
  async adoptServer(): Promise<ReadingLocator | undefined> {
    const result = await api<ProgressResponse>(`/reader/files/${this.file.id}/progress`)
    if (result.sourceHash && result.sourceHash !== this.file.sha256) throw new Error('服务器记录对应其他文件内容，请重新打开书籍。')
    this.revision = result.revision; this.pending = undefined; this.conflict = false; this.confirmed = result.locator || ''
    this.current = parseLocator(result.locator); this.persist(); return this.current
  }
  async adoptLocal() {
    const result = await api<ProgressResponse>(`/reader/files/${this.file.id}/progress`)
    this.revision = result.revision; this.pending = undefined; this.conflict = false; this.confirmed = ''; await this.flush()
  }
  async sourceUpdated(file: Note) {
    await this.flush()
    const server = await api<ProgressResponse>(`/reader/files/${file.id}/progress`)
    if (server.revision !== this.revision) { this.conflict = true; this.status('另一设备已更新进度，请选择采用位置。') }
    this.file = file; this.revision = server.revision; this.pending = undefined; this.fileChanged = false
    this.confirmed = server.sourceHash === file.sha256 ? server.locator || '' : ''
  }
  pause() { clearTimeout(this.timer); this.persist(); void this.flush() }
  close() { this.stopped = true; clearTimeout(this.timer); this.persist(); void this.flush() }
}
