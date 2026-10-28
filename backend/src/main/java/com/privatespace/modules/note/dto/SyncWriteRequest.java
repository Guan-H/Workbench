package com.privatespace.modules.note.dto;

import jakarta.validation.constraints.NotBlank;

/** Whole-file M0 prototype transport; SHA-256 is checked before publishing any version. */
public record SyncWriteRequest(String id, @NotBlank String path, @NotBlank String baseVersion,
        boolean deleted, String sha256, String contentBase64) { }
