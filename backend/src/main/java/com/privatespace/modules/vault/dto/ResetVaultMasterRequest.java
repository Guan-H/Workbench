package com.privatespace.modules.vault.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import tools.jackson.databind.JsonNode;

/** A recovery reset may change the password wrapper, never the encrypted contents. */
public record ResetVaultMasterRequest(
        @NotNull @Pattern(regexp = "[1-9][0-9]{0,18}") String baseVersion,
        @NotNull @Pattern(regexp = "[0-9a-f-]{36}") String recoveryId,
        @NotNull JsonNode envelope) {
    @JsonAnySetter
    public void rejectUnknown(String name, JsonNode value) {
        throw new IllegalArgumentException("Unexpected recovery reset field");
    }
}
