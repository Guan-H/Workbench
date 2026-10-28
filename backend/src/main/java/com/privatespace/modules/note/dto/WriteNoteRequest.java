package com.privatespace.modules.note.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record WriteNoteRequest(@NotNull @Size(max = 512) String path,
        @NotNull String type, String content, String baseVersion) {
}
