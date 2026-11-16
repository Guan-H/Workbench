package com.privatespace.modules.english.dto;

import java.util.List;
import java.util.Map;
import java.util.Set;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import com.privatespace.modules.english.dto.EnglishDtos.Article;
import com.privatespace.modules.english.dto.EnglishDtos.Word;
import com.privatespace.modules.english.dto.ReadingDtos.Origin;

/** Course answers are returned only after that question has a persisted attempt. */
public final class CourseDtos {
    private CourseDtos() {}
    public record Sentence(String text, String translation, String vocabulary, String forms, String structure) {}
    public record Question(String prompt, List<String> options, int answer, String explanation, String evidence) {}
    public record Content(Article article, List<Sentence> sentences, List<Word> words, List<Question> questions, Origin origin) {}
    public record State(String position, Map<String, Integer> answers, Set<Integer> marked, Set<Integer> wrong, boolean completed, Boolean favorite) {
        public State { favorite = Boolean.TRUE.equals(favorite); }
    }
    public record Summary(String id, String title, String focus, String source, String revision,
            String position, boolean completed, int answered, int reviewCount, Boolean favorite, String kind) {
        public Summary { favorite = Boolean.TRUE.equals(favorite); kind = kind == null ? "original" : kind; }
    }
    public record Page(List<Summary> items, long total, int page) {}
    public record SentenceEntry(String courseId, String title, int sentenceIndex, String text, boolean marked) {}
    public record SentencePage(List<SentenceEntry> items, long total, int page) {}
    public record QuestionView(String prompt, List<String> options, Integer selected,
            Integer answer, String explanation, String evidence) {}
    public record Detail(Summary summary, Article article, List<Sentence> sentences, List<Word> words,
            List<QuestionView> questions, Set<Integer> marked, Set<Integer> wrong, Origin origin) {}
    public record Change(@NotNull @Size(max=20) String baseRevision,
            @NotNull @Pattern(regexp="position|answer|mark|finish|favorite") String action,
            @Size(max=32) String position, Integer index, Integer choice, Boolean marked,
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
            Boolean favorite) {}
}
