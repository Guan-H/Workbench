import type { VaultCommand, VaultReply } from './vault-worker'

/** Keys stay in one dedicated Worker, discarded on every lock or failed operation. */
export class VaultWorker {
  private worker: Worker | undefined
  private pending: ((cause: Error) => void) | undefined

  async request(command: VaultCommand): Promise<VaultReply> {
    if (this.pending) throw new Error('VAULT_BUSY')
    this.worker ??= new Worker(new URL('./vault-worker.ts', import.meta.url), { type: 'module' })
    const worker = this.worker
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.lock(); reject(new Error('VAULT_TIMEOUT')) }, 30000)
      this.pending = cause => { clearTimeout(timer); reject(cause) }
      worker.onerror = () => { this.lock() }
      worker.onmessage = (event: MessageEvent<VaultReply>) => {
        clearTimeout(timer); this.pending = undefined
        if (event.data.kind === 'error') { this.lock(); reject(new Error('VAULT_REJECTED')) }
        else resolve(event.data)
      }
      try { worker.postMessage(command) }
      catch {
        clearTimeout(timer); this.pending = undefined
        reject(new Error('VAULT_MESSAGE_FAILED'))
      }
    })
  }

  lock() {
    const reject = this.pending
    this.pending = undefined
    if (this.worker) { this.worker.postMessage({ kind: 'lock' } satisfies VaultCommand); this.worker.terminate(); this.worker = undefined }
    reject?.(new Error('VAULT_LOCKED'))
  }
}
