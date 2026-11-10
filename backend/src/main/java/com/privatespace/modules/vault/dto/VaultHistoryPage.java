package com.privatespace.modules.vault.dto;

import java.util.List;

/** Public history metadata only; ciphertext is fetched one version at a time. */
public record VaultHistoryPage(List<Item> items, long total, int page, int pageSize, String anchor, String currentVersion) {
    public record Item(String version, String createdAt, String operationKind) { }
}
