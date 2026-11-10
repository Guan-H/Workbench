package com.privatespace.modules.vault.entity;

public record VaultHistoryEntity(long version, String createdAt, String operationKind) {
}
