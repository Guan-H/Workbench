package com.privatespace.modules.english.entity;

import java.time.LocalDate;

/** Ordinary learning records; no credential or vault fields belong here. */
public final class StudyEntities {
    private StudyEntities() {}
    public record State(long catalogCursor, long revision, int newLimit, int reviewLimit, int sentenceLimit) {}
    public record Item(String id, String kind, String name, String meaning, String payload) {}
    public record Source(long batchId, String date, int articleIndex) {}
    public record Progress(String itemId, String mode, int stage, int mistakes, LocalDate lastDate, LocalDate wrongDate, LocalDate nextDate) {}
    public record Plan(long id, LocalDate learningDate, String operation, int newLimit, int reviewLimit, int sentenceLimit, Long anchorBatchId) {}
    public record Task(String id, long planId, String itemId, String mode, String kind, boolean completed, long revision,
            String answer, boolean submitted, String rating, String gameId) {}
    public record Operation(String requestHash, String responseJson) {}
}
