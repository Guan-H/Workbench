import sodium from 'libsodium-wrappers-sumo'
import { createVault, unlockVault, parseEnvelope, rewrapVault, readContent, sealContent, sealDraft, openDraft, type VaultEnvelope, type EncryptedDraft } from './envelope'
import { summarizeDraft, type VaultDraft, type VaultDraftSummary, type VaultEntry } from './entries'

export type VaultCommand = { kind: 'create'; password: string } | { kind: 'unlock'; password: string; envelope: unknown; id: string }
  | { kind: 'seal'; content: unknown } | { kind: 'draft'; draft: unknown } | { kind: 'open-draft' | 'describe-draft'; envelope: unknown }
  | { kind: 'adopt' | 'inspect'; envelope: unknown }
  | { kind: 'rewrap'; currentPassword: string; newPassword: string } | { kind: 'lock' }
export type VaultReply = { kind: 'created' | 'rewrapped' | 'sealed'; envelope: VaultEnvelope }
  | { kind: 'unlocked' | 'adopted' | 'inspected'; entries: VaultEntry[] }
  | { kind: 'draft'; envelope: EncryptedDraft } | { kind: 'opened-draft'; draft: VaultDraft } | { kind: 'locked' } | { kind: 'error' }
  | { kind: 'draft-summary'; summary: VaultDraftSummary }
let key: Uint8Array | undefined
let envelope: VaultEnvelope | undefined
let busy = false
let generation = 0
function lock() { generation++; if (key) sodium.memzero(key); key = undefined; envelope = undefined }
self.onmessage = async (event: MessageEvent<VaultCommand>) => {
  const command = event.data
  if (command.kind === 'lock') { lock(); self.postMessage({ kind: 'locked' } satisfies VaultReply); return }
  if (busy) { self.postMessage({ kind: 'error' } satisfies VaultReply); return }
  busy = true
  if (command.kind === 'create' || command.kind === 'unlock') lock()
  const expected = generation
  try {
    if (command.kind !== 'create' && command.kind !== 'unlock' && command.kind !== 'rewrap') {
      if (!key || !envelope) throw new Error('VAULT_LOCKED')
      if (command.kind === 'seal') self.postMessage({ kind: 'sealed', envelope: sealContent(envelope, key, command.content) } satisfies VaultReply)
      else if (command.kind === 'draft') self.postMessage({ kind: 'draft', envelope: sealDraft(envelope, key, command.draft) } satisfies VaultReply)
      else if (command.kind === 'open-draft' || command.kind === 'describe-draft') {
        const draft = await openDraft(command.envelope, envelope, key)
        if (expected === generation) self.postMessage(command.kind === 'describe-draft'
          ? { kind: 'draft-summary', summary: summarizeDraft(draft) } satisfies VaultReply
          : { kind: 'opened-draft', draft } satisfies VaultReply)
      } else {
        const next = await parseEnvelope(command.envelope)
        if (next.vaultId !== envelope.vaultId || next.keyId !== envelope.keyId) throw new Error('VAULT_IDENTITY_MISMATCH')
        const entries = readContent(next, key).entries
        if (expected !== generation) return
        if (command.kind === 'adopt') envelope = next
        self.postMessage({ kind: command.kind === 'adopt' ? 'adopted' : 'inspected', entries } satisfies VaultReply)
      }
      return
    }
    if (command.kind === 'rewrap') {
      if (!key || !envelope) throw new Error('VAULT_LOCKED')
      const changed = await rewrapVault(envelope, key, command.currentPassword, command.newPassword)
      if (expected === generation) self.postMessage({ kind: 'rewrapped', envelope: changed } satisfies VaultReply)
      return
    }
    const result = command.kind === 'create' ? await createVault(command.password)
      : { key: await unlockVault(command.envelope, command.password, command.id) }
    if (expected !== generation) { sodium.memzero(result.key); return }
    const activeEnvelope = 'envelope' in result ? result.envelope : await parseEnvelope(command.kind === 'unlock' ? command.envelope : undefined)
    if (expected !== generation) { sodium.memzero(result.key); return }
    key = result.key
    envelope = activeEnvelope
    self.postMessage('envelope' in result ? { kind: 'created', envelope: result.envelope } satisfies VaultReply : { kind: 'unlocked', entries: readContent(envelope, key).entries } satisfies VaultReply)
  } catch { lock(); self.postMessage({ kind: 'error' } satisfies VaultReply) }
  finally {
    if (command.kind === 'rewrap') { command.currentPassword = ''; command.newPassword = '' }
    else if ('password' in command) command.password = ''
    else if (command.kind === 'seal') command.content = undefined
    else if (command.kind === 'draft') command.draft = undefined
    busy = false
  }
}
