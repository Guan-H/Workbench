package com.privatespace.modules.english.entity;

import java.time.Instant;
import java.util.List;
import com.privatespace.modules.english.dto.EnglishDtos.Word;
import com.privatespace.modules.english.dto.WordGameDtos.Answer;
import com.privatespace.modules.english.dto.WordGameDtos.Feedback;

/** Immutable round snapshot. Card order and mistakes survive request retries and server restarts. */
public record WordGameState(List<Word> pairs, List<Integer> wordOrder, List<Integer> meaningOrder,
        List<Integer> matched, List<Integer> mistakes, int attempts, int streak, int bestStreak,
        int sourceCount, int eligibleCount, Instant startedAt, Long finishedSeconds, LastOperation lastOperation,
        String mode) {
    public record LastOperation(String id, Answer answer, Feedback feedback) {}
}
