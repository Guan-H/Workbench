import sodium from 'libsodium-wrappers-sumo'
import { generateRecovery, recoverDataKey, resetWithRecovery } from './recovery-crypto'
import type { RecoveryEnvelope } from './recovery-format'
import { createVault, createBackup, openBackup, unlockVault, parseEnvelope, rewrapVault, readContent, sealContent, sealDraft, openDraft, type VaultEnvelope, type EncryptedDraft } from './envelope'
import { summarizeDraft, type VaultContent, type VaultDraft, type VaultDraftSummary, type VaultEntry } from './entries'
import { parseBackup, type VaultBackup, type BackupSummary } from './backup'
import { expiredTrash, type ExpiredTrashItem } from './retention'
import type { CustomEntryAvatar } from './entry-avatar'

export type VaultCommand = { kind: 'recovery-generate'; currentPassword: string }
  | { kind: 'recovery-confirm'; token: string; secret: string }
  | { kind: 'recovery-reset'; envelope: unknown; recovery: unknown; secret: string; newPassword: string }
  | { kind: 'recovery-clear' }
  | { kind: 'create'; password: string } | { kind: 'unlock'; password: string; envelope: unknown; id: string }
  | { kind: 'seal'; content: unknown } | { kind: 'draft'; draft: unknown } | { kind: 'open-draft' | 'describe-draft'; envelope: unknown }
  | { kind: 'adopt' | 'inspect'; envelope: unknown }
  | { kind: 'rewrap'; currentPassword: string; newPassword: string } | { kind: 'lock' }
  | { kind: 'backup-export'; envelope: unknown; currentPassword: string; backupPassword: string }
  | { kind: 'backup-preview'; backup: unknown; backupPassword: string }
  | { kind: 'backup-build'; token: string; newPassword?: string }
  | { kind: 'backup-clear' }
  | { kind: 'history-preview'; envelope: unknown }
  | { kind: 'cleanup-preview'; cutoff: string }
export type VaultReply = { kind: 'recovery-generated'; token: string; secret: string }
  | { kind: 'recovery-configured'; recovery: RecoveryEnvelope }
  | { kind: 'recovery-reset'; envelope: VaultEnvelope }
  | { kind: 'recovery-cleared' | 'recovery-rejected' }
  | { kind: 'created' | 'rewrapped' | 'sealed'; envelope: VaultEnvelope }
  | { kind: 'unlocked' | 'adopted' | 'inspected'; entries: VaultEntry[]; avatars: CustomEntryAvatar[] }
  | { kind: 'draft'; envelope: EncryptedDraft } | { kind: 'opened-draft'; draft: VaultDraft } | { kind: 'locked' } | { kind: 'error' }
  | { kind: 'draft-summary'; summary: VaultDraftSummary }
  | { kind: 'backup-exported'; backup: VaultBackup }
  | { kind: 'backup-previewed'; token: string; summary: BackupSummary }
  | { kind: 'backup-candidate'; envelope: VaultEnvelope }
  | { kind: 'backup-cleared' | 'backup-rejected' }
  | { kind: 'cleanup-previewed'; token: string; summary: BackupSummary; items: ExpiredTrashItem[] }
let key: Uint8Array | undefined
let envelope: VaultEnvelope | undefined
let busy = false
let generation = 0
let restore: { token: string; content: VaultContent } | undefined
let recoveryStage: { token: string; recovery: RecoveryEnvelope } | undefined
function lock() { recoveryStage = undefined; generation++; if (key) sodium.memzero(key); key = undefined; envelope = undefined; restore = undefined }
self.onmessage = async (event: MessageEvent<VaultCommand>) => {
  const command = event.data
  if (command.kind === 'lock') { lock(); self.postMessage({ kind: 'locked' } satisfies VaultReply); return }
  if (busy) { self.postMessage({ kind: 'error' } satisfies VaultReply); return }
  busy = true
  if (command.kind === 'create' || command.kind === 'unlock' || command.kind === 'recovery-reset') lock()
  const expected = generation
  try {
    if (command.kind === 'recovery-clear') { recoveryStage = undefined; self.postMessage({ kind: 'recovery-cleared' } satisfies VaultReply); return }
    if (command.kind === 'recovery-generate') {
      recoveryStage = undefined
      if (!envelope || !key) throw new Error('VAULT_LOCKED')
      const generated = await generateRecovery(envelope, key, command.currentPassword)
      if (expected !== generation) return
      recoveryStage = { token: crypto.randomUUID(), recovery: generated.recovery }
      self.postMessage({ kind: 'recovery-generated', token: recoveryStage.token, secret: generated.secret } satisfies VaultReply)
      return
    }
    if (command.kind === 'recovery-confirm') {
      if (!recoveryStage || recoveryStage.token !== command.token || !envelope || !key) throw new Error('RECOVERY_PREVIEW_EXPIRED')
      const staged = recoveryStage; recoveryStage = undefined
      const verified = await recoverDataKey(envelope, staged.recovery, command.secret)
      try { if (!sodium.memcmp(verified, key)) throw new Error('RECOVERY_KEY_MISMATCH') } finally { sodium.memzero(verified) }
      if (expected === generation) self.postMessage({ kind: 'recovery-configured', recovery: staged.recovery } satisfies VaultReply)
      return
    }
    if (command.kind === 'recovery-reset') {
      const source = await parseEnvelope(command.envelope)
      const result = await resetWithRecovery(source, command.recovery, command.secret, command.newPassword)
      if (expected === generation) self.postMessage({ kind: 'recovery-reset', envelope: result } satisfies VaultReply)
      return
    }
    if (command.kind === 'history-preview' || command.kind === 'cleanup-preview') {
      if (!key || !envelope) throw new Error('VAULT_LOCKED')
      let content: VaultContent
      let items: ExpiredTrashItem[] = []
      if (command.kind === 'history-preview') {
        const previous = await parseEnvelope(command.envelope)
        if (previous.vaultId !== envelope.vaultId || previous.keyId !== envelope.keyId) throw new Error('VAULT_IDENTITY_MISMATCH')
        content = readContent(previous, key)
      } else {
        content = readContent(envelope, key)
        items = expiredTrash(content.entries, command.cutoff)
        const ids = new Set(items.map(item => item.id))
        content = { ...content, entries: content.entries.filter(item => !ids.has(item.id)) }
      }
      if (expected !== generation) return
      restore = { token: crypto.randomUUID(), content }
      const summary: BackupSummary = { total: content.entries.length, login: content.entries.filter(item => item.type === 'login').length,
        secureNote: content.entries.filter(item => item.type === 'secure-note').length, deleted: content.entries.filter(item => !!item.deletedAt).length }
      self.postMessage(command.kind === 'cleanup-preview'
        ? { kind: 'cleanup-previewed', token: restore.token, summary, items } satisfies VaultReply
        : { kind: 'backup-previewed', token: restore.token, summary } satisfies VaultReply)
      return
    }
    if (command.kind === 'backup-clear') { restore = undefined; self.postMessage({ kind: 'backup-cleared' } satisfies VaultReply); return }
    if (command.kind === 'backup-export') {
      if (command.currentPassword === command.backupPassword) throw new Error('BACKUP_PASSWORD_MUST_DIFFER')
      const source = await parseEnvelope(command.envelope)
      const sourceKey = await unlockVault(source, command.currentPassword, source.vaultId)
      try {
        const sealed = await createBackup(command.backupPassword, readContent(source, sourceKey))
        if (expected === generation) self.postMessage({ kind: 'backup-exported', backup: { format: 'private-space-vault-backup', version: 1, envelope: sealed } } satisfies VaultReply)
      } finally { sodium.memzero(sourceKey) }
      return
    }
    if (command.kind === 'backup-preview') {
      restore = undefined
      const backup = await parseBackup(command.backup)
      const content = await openBackup(backup.envelope, command.backupPassword)
      if (expected !== generation) return
      restore = { token: crypto.randomUUID(), content }
      self.postMessage({ kind: 'backup-previewed', token: restore.token, summary: { total: content.entries.length,
        login: content.entries.filter(item => item.type === 'login').length, secureNote: content.entries.filter(item => item.type === 'secure-note').length,
        deleted: content.entries.filter(item => !!item.deletedAt).length } } satisfies VaultReply)
      return
    }
    if (command.kind === 'backup-build') {
      if (!restore || restore.token !== command.token) throw new Error('BACKUP_PREVIEW_EXPIRED')
      const content = restore.content
      restore = undefined
      if (command.newPassword !== undefined) {
        const created = await createVault(command.newPassword)
        try {
          const candidate = sealContent(created.envelope, created.key, content)
          if (expected === generation) self.postMessage({ kind: 'backup-candidate', envelope: candidate } satisfies VaultReply)
        } finally { sodium.memzero(created.key) }
      } else {
        if (!key || !envelope) throw new Error('VAULT_LOCKED')
        self.postMessage({ kind: 'backup-candidate', envelope: sealContent(envelope, key, content) } satisfies VaultReply)
      }
      return
    }
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
        const content = readContent(next, key)
        if (expected !== generation) return
        if (command.kind === 'adopt') envelope = next
        self.postMessage({ kind: command.kind === 'adopt' ? 'adopted' : 'inspected', entries: content.entries, avatars: content.avatars ?? [] } satisfies VaultReply)
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
    if ('envelope' in result) self.postMessage({ kind: 'created', envelope: result.envelope } satisfies VaultReply)
    else {
      const content = readContent(envelope, key)
      self.postMessage({ kind: 'unlocked', entries: content.entries, avatars: content.avatars ?? [] } satisfies VaultReply)
    }
  } catch {
    if (command.kind.startsWith('recovery-')) { recoveryStage = undefined; self.postMessage({ kind: 'recovery-rejected' } satisfies VaultReply) }
    else if (command.kind.startsWith('backup-')) { restore = undefined; self.postMessage({ kind: 'backup-rejected' } satisfies VaultReply) }
    else { lock(); self.postMessage({ kind: 'error' } satisfies VaultReply) }
  }
  finally {
    if (command.kind === 'rewrap') { command.currentPassword = ''; command.newPassword = '' }
    else if (command.kind === 'recovery-generate') command.currentPassword = ''
    else if (command.kind === 'recovery-confirm') command.secret = ''
    else if (command.kind === 'recovery-reset') { command.secret = ''; command.newPassword = '' }
    else if (command.kind === 'backup-export') { command.currentPassword = ''; command.backupPassword = '' }
    else if (command.kind === 'backup-preview') { command.backupPassword = ''; command.backup = undefined }
    else if (command.kind === 'backup-build') command.newPassword = undefined
    else if ('password' in command) command.password = ''
    else if (command.kind === 'seal') command.content = undefined
    else if (command.kind === 'draft') command.draft = undefined
    busy = false
  }
}
