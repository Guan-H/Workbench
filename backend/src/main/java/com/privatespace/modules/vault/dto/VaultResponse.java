package com.privatespace.modules.vault.dto;

import tools.jackson.databind.JsonNode;

/** Only authenticated ciphertext and public metadata cross the storage boundary. */
public record VaultResponse(boolean initialized, String vaultId, String version, JsonNode envelope, String createdAt) {
    public static VaultResponse empty() { return new VaultResponse(false, null, null, null, null); }
}
