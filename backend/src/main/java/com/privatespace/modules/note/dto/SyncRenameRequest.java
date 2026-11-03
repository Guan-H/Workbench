package com.privatespace.modules.note.dto;

import jakarta.validation.constraints.NotBlank;

/** Conditional file relocation; content is optional when only the path changes. */
public record SyncRenameRequest(@NotBlank String id, @NotBlank String sourcePath, @NotBlank String targetPath,
        @NotBlank String baseVersion, @NotBlank String sha256, String contentBase64) { }
