package com.privatespace.modules.vault.entity;

public record VaultOperationEntity(String vaultId, long version, long baseVersion, String envelope, String operationKind) {
}
