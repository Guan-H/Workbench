package com.privatespace.modules.english.dto;

import java.util.List;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Plain word/meaning input; preview does not import the submitted vocabulary. */
public final class WordImportDtos {
    private WordImportDtos() {}

    public record Request(@NotBlank @Size(max = 100000) String text) {}
    public record Entry(int line, String word, String meaning, String status, String message) {}
    public record Preview(List<Entry> entries, int newWords, int duplicates, int invalid) {}
    public record Result(int added, int skipped) {}
}
