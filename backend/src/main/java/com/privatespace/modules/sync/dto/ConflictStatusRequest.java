package com.privatespace.modules.sync.dto;

import java.util.List;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;

/** Metadata observed by one authorized helper; no file content or local absolute path. */
public record ConflictStatusRequest(@NotBlank @Pattern(regexp = "[1-9][0-9]{0,18}") @DecimalMax("9223372036854775807") String revision,
        @NotNull @Size(max = 200) List<@NotNull @Valid Item> items) {
    public record Item(@NotBlank @Size(max = 240) String path, @NotNull Boolean active,
            @NotBlank @Pattern(regexp = "[A-Z_]{1,80}") String reason,
            @NotBlank @Pattern(regexp = "present|missing|unavailable") String localState,
            @Pattern(regexp = "[a-f0-9]{64}") String localSha256,
            @Pattern(regexp = "[a-f0-9-]{36}") String baselineId,
            @Pattern(regexp = "[1-9][0-9]{0,18}") String baselineVersion,
            @Pattern(regexp = "[a-f0-9]{64}") String baselineSha256,
            @Min(0) @Max(1000000) int copies) { }
}
