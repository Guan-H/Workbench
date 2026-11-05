package com.privatespace.modules.vault.dto;

import jakarta.validation.constraints.NotNull;
import tools.jackson.databind.JsonNode;
import com.fasterxml.jackson.annotation.JsonAnySetter;

public record CreateVaultRequest(@NotNull JsonNode envelope) {
    @JsonAnySetter
    public void rejectUnknown(String name, JsonNode value) {
        throw new IllegalArgumentException("Only an encrypted envelope is accepted");
    }
}
