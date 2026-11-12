package com.privatespace.modules.english.dto;

import java.util.List;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import com.privatespace.modules.english.dto.EnglishDtos.Word;

/** Authenticated word practice; the server grades and stores every attempt. */
public final class WordGameDtos {
    private WordGameDtos() {}
    public static final String UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

    public record Create(@NotNull @Pattern(regexp = "[1-9][0-9]{0,17}") String batchId,
            @Pattern(regexp = UUID_PATTERN) String reviewOf,
            @Pattern(regexp = "matching|spelling") String mode,
            @Pattern(regexp = "[1-9][0-9]{0,17}") String studyPlanId) {
        public Create(String batchId,String reviewOf,String mode) { this(batchId,reviewOf,mode,null); }
    }

    public record Answer(@NotNull @Pattern(regexp = "0|[1-9][0-9]{0,17}") String baseRevision,
            @NotNull @PositiveOrZero Integer wordId, @PositiveOrZero Integer meaningId,
            @Size(max = 100) String spelling) {}

    public record Choice(int id, String label) {}
    public record Feedback(int wordId, int meaningId, boolean correct) {}
    public record SpellingPrompt(int wordId, String meaning, String example) {}
    public record Snapshot(String id, String batchId, String revision, int sourceCount, int eligibleCount,
            List<Choice> words, List<Choice> meanings, List<Integer> matched, int attempts, int streak,
            int bestStreak, List<Word> mistakes, boolean completed, long elapsedSeconds, Feedback feedback,
            String mode, SpellingPrompt spellingPrompt) {}
}
