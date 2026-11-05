import type { VaultEnvelope } from './envelope'

export interface SavedVault { initialized: true; vaultId: string; version: string; envelope: VaultEnvelope; createdAt: string }
export interface PendingVaultSave { baseVersion: string; envelope: VaultEnvelope; operation: string }
