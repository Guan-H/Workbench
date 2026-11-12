package com.privatespace.modules.english.dto;

import java.util.List;

/** Public contracts for the scoped daily-English receiver and authenticated dashboard. */
public final class EnglishDtos {
    private EnglishDtos() {}
    public record Sentence(String text, String translation) {}
    public record Article(String title, String text, String translation,
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
            List<Sentence> sentences) {
        public Article(String title, String text, String translation) { this(title, text, translation, null); }
    }
    public record Word(String word, String phonetic, String meaning, String example) {}
    public record Submission(String requestId, String date, List<Article> articles, List<Word> words) {}
    public record Status(String revision, boolean configured, boolean enabled) {}
    public record Change(String baseRevision, String action) {}
    public record Credential(Status status, String token) {}
    public record Receipt(String id, String date, boolean duplicate) {}
    public record Batch(String id, String receivedAt, Submission content) {}
    public record History(String id, String requestId, String date, String receivedAt) {}
    public record Daily(String date, Batch latest, List<History> history, long total, int page) {}
    public record Log(String id, String requestId, String status, String code, String receivedAt) {}
    public record Logs(List<Log> items, long total, int page) {}
}
