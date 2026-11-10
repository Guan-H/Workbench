package com.privatespace.modules.vault.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import tools.jackson.databind.JsonNode;

/** Only encrypted key wrappers cross this boundary, never the recovery secret. */
public record ConfigureVaultRecoveryRequest(
        @NotNull @Pattern(regexp = "[1-9][0-9]{0,18}") String baseVersion,
        @NotNull JsonNode envelope, @NotNull JsonNode recovery) {
    @JsonAnySetter
    public void rejectUnknown(String name, JsonNode value) {
        throw new IllegalArgumentException("Unexpected recovery configuration field");
    }
}
