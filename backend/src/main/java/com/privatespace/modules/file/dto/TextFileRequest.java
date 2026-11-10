package com.privatespace.modules.file.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record TextFileRequest(@NotNull @Pattern(regexp = "[1-9][0-9]{0,18}") String baseVersion,
        @NotNull String path, @NotNull String content, @NotNull String encoding, boolean bom) {}
