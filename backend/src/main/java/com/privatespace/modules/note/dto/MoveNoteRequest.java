package com.privatespace.modules.note.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record MoveNoteRequest(@NotBlank @Size(max = 240) String targetPath,
        @NotBlank String baseVersion, String fingerprint) {
}
