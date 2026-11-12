package com.privatespace.modules.english.dto;

import java.util.List;
import jakarta.validation.constraints.*;
import com.privatespace.modules.english.dto.EnglishDtos.Word;

/** Public study contracts distinguish server-graded words from self-assessed translations. */
public final class StudyDtos {
    private StudyDtos() {}
    public record Settings(String revision, int newLimit, int reviewLimit, int sentenceLimit) {}
    public record ChangeSettings(@NotNull String baseRevision, @Min(1) @Max(50) int newLimit,
            @Min(1) @Max(100) int reviewLimit, @Min(1) @Max(20) int sentenceLimit) {}
    public record Source(String batchId, String date, int articleIndex) {}
    public record Progress(String mode, int stage, int mistakes, String nextDate) {}
    public record Item(String id, String kind, String name, String meaning, Word word, List<Source> sources, List<Progress> progress) {}
    public record Items(List<Item> items, long total, int page) {}
    public record Task(String id, String itemId, String mode, String kind, boolean completed,
            String revision, String prompt, String reference, String answer, boolean submitted, String rating, String gameId,List<Source> sources) {}
    public record Plan(String id, String date, String batchId, int newLimit, int reviewLimit, int sentenceLimit,
            List<Task> tasks, List<Word> vocabulary, String matchingGame, String spellingGame) {}
    public record Dashboard(Settings settings, long words, long sentences, long wrongWords, long due, Plan plan) {}
    public record SaveTranslation(@NotNull String baseRevision, @NotNull @Size(max=8000) String answer,
            @NotNull @Pattern(regexp="draft|submit|rate") String action,
            @Pattern(regexp="good|improve|unknown") String rating) {}
}
