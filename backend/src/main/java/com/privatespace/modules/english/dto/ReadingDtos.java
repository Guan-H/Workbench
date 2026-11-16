package com.privatespace.modules.english.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** Source metadata remains distinct from supplied or AI-generated translations. */
public final class ReadingDtos {
    private ReadingDtos() {}
    public record Origin(String kind, String url, String publishedAt, String provider, String licenseUrl) {}
    public record AddArticle(@NotBlank @Size(max=200) String title,
            @NotBlank @Size(max=100000) String text,
            @Size(max=100000) String translation, @Size(max=2000) String sourceUrl) {}
    public record SourceStatus(String id, String name, String revision, boolean enabled, boolean running,
            String lastAttemptAt, String lastSuccessAt, int added, int skipped, String error, String retryAfterAt) {}
    public record Configure(@NotNull @Size(max=20) String baseRevision, @NotNull Boolean enabled) {}
}
