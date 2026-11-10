package com.privatespace.modules.reader.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** A logical text position, conditional on the opened content and previously observed progress. */
public record ReadingProgressRequest(
        @Pattern(regexp = "0|[1-9][0-9]{0,17}") String baseRevision,
        @Pattern(regexp = "[1-9][0-9]{0,17}") String sourceVersion,
        @Pattern(regexp = "[a-f0-9]{64}") String sourceHash,
        @Pattern(regexp = "txt|epub|md") String format,
        @NotBlank @Size(max = 2048) String locator) {
}
