package com.privatespace.modules.vault.entity;

public record VaultSnapshotEntity(String vaultId, long version, String envelope, String creationOperation, String createdAt) {
}
