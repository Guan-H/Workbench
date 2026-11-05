package com.privatespace.modules.vault.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import tools.jackson.databind.JsonNode;

/** Only an encrypted snapshot and its expected server version may be submitted. */
public record UpdateVaultRequest(@NotNull @Pattern(regexp = "[1-9][0-9]{0,18}") String baseVersion,
        @NotNull JsonNode envelope) {
    @JsonAnySetter
    public void rejectUnknown(String name, JsonNode value) {
        throw new IllegalArgumentException("Only a version and encrypted envelope are accepted");
    }
}
