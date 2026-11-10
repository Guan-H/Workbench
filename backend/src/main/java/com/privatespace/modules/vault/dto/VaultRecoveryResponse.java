package com.privatespace.modules.vault.dto;

import tools.jackson.databind.JsonNode;

/** Authenticated metadata and encrypted recovery wrapper only. */
public record VaultRecoveryResponse(boolean enabled, String version, JsonNode recovery) {}
