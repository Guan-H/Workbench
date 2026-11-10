package com.privatespace.modules.english.service.impl;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.stream.IntStream;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.english.dto.EnglishDtos.Word;
import com.privatespace.modules.english.dto.WordGameDtos.*;
import com.privatespace.modules.english.entity.WordGameEntity;
import com.privatespace.modules.english.entity.WordGameState;
import com.privatespace.modules.english.entity.WordGameState.LastOperation;
import com.privatespace.modules.english.mapper.WordGameMapper;
import com.privatespace.modules.english.service.EnglishService;
import com.privatespace.modules.english.service.WordGameService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class WordGameServiceImpl implements WordGameService {
    private final WordGameMapper mapper;
    private final EnglishService english;
    private final ObjectMapper json;

    public WordGameServiceImpl(WordGameMapper mapper, EnglishService english, ObjectMapper json) {
        this.mapper = mapper;
        this.english = english;
        this.json = json;
    }

    @Override
    @Transactional
    public Snapshot create(Create request, String operation) {
        List<Word> source;
        int sourceCount;
        int eligibleCount;
        String mode = request.mode() == null ? "matching" : request.mode();
        long batchId = Long.parseLong(request.batchId());
        if (request.reviewOf() == null) {
            source = english.batchContent(batchId).words();
            sourceCount = source.size();
            source = unique(source);
            eligibleCount = source.size();
        } else {
            WordGameEntity previous = require(mapper.find(request.reviewOf()));
            WordGameState state = state(previous);
            if (previous.batchId() != batchId || state.finishedSeconds() == null) {
                throw new ApiException(409, "WORD_REVIEW_NOT_READY", "请先完成这一轮，再练错词。");
            }
            if (request.mode() == null) mode = mode(state);
            if (!mode(state).equals(mode)) {
                throw new ApiException(409, "WORD_REVIEW_MODE_CHANGED", "错词重练须使用原练习模式。");
            }
            source = state.mistakes().stream().map(state.pairs()::get).toList();
            sourceCount = source.size();
            eligibleCount = source.size();
        }
        if (source.isEmpty()) throw new ApiException(409, "NO_PRACTICE_WORDS", "当前批次没有可练习的单词。");
        var pairs = new ArrayList<>(source);
        Collections.shuffle(pairs);
        List<Word> selected = List.copyOf(pairs.subList(0, Math.min(6, pairs.size())));
        var initial = new WordGameState(selected, order(selected.size()), order(selected.size()), List.of(),
                List.of(), 0, 0, 0, sourceCount, eligibleCount, Instant.now(), null, null, mode);
        // The operation UUID is the round ID, so a lost create response can be retried without another round.
        mapper.create(new WordGameEntity(operation, batchId, request.reviewOf(), 0, json.writeValueAsString(initial)));
        WordGameEntity saved = require(mapper.lock(operation));
        if (saved.batchId() != batchId || !Objects.equals(saved.reviewOf(), request.reviewOf()) || !mode(state(saved)).equals(mode)) {
            throw new ApiException(409, "WORD_GAME_OPERATION_CHANGED", "同一操作不能用于不同批次或练习。");
        }
        return view(saved);
    }

    /** Identical labels cannot form an unambiguous matching question. Preserve the original batch. */
    private List<Word> unique(List<Word> words) {
        var names = new HashSet<String>();
        var meanings = new HashSet<String>();
        var result = new ArrayList<Word>();
        for (Word word : words) {
            String name = word.word().strip().toLowerCase(Locale.ROOT);
            String meaning = word.meaning().strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
            if (!names.contains(name) && !meanings.contains(meaning)) {
                names.add(name);
                meanings.add(meaning);
                result.add(word);
            }
        }
        return result;
    }

    private List<Integer> order(int count) {
        var order = new ArrayList<>(IntStream.range(0, count).boxed().toList());
        Collections.shuffle(order);
        return List.copyOf(order);
    }

    @Override
    public Snapshot read(String id) { return view(require(mapper.find(id))); }

    @Override
    @Transactional
    public Snapshot answer(String id, Answer request, String operation) {
        WordGameEntity row = require(mapper.lock(id));
        WordGameState old = state(row);
        if (old.lastOperation() != null && old.lastOperation().id().equals(operation)) {
            if (!old.lastOperation().answer().equals(request)) {
                throw new ApiException(409, "WORD_GAME_OPERATION_CHANGED", "同一操作不能提交不同答案。");
            }
            return view(row);
        }
        if (!Long.toString(row.revision()).equals(request.baseRevision())) {
            throw new ApiException(409, "WORD_GAME_CHANGED", "练习状态已变化，请读取最新进度后继续。");
        }
        boolean spelling = "spelling".equals(mode(old));
        if ((spelling && (request.meaningId() != null || request.spelling() == null || request.spelling().isBlank()))
                || (!spelling && (request.meaningId() == null || request.spelling() != null))) {
            throw new ApiException(400, "INVALID_WORD_ANSWER", "请按当前练习模式提交配对或英文拼写。");
        }
        int word = request.wordId(), meaning = spelling ? word : request.meaningId();
        if (word >= old.pairs().size() || meaning >= old.pairs().size()) {
            throw new ApiException(400, "INVALID_WORD_CHOICE", "请选择本轮中的单词和释义。");
        }
        if (old.finishedSeconds() != null || old.matched().contains(word) || old.matched().contains(meaning)) {
            throw new ApiException(409, "WORD_ALREADY_MATCHED", "这组卡片已完成，请读取最新进度。");
        }
        if (spelling && old.wordOrder().get(old.matched().size()) != word) {
            throw new ApiException(409, "WORD_QUESTION_CHANGED", "请选择当前拼写题，或读取最新进度后继续。");
        }
        boolean correct = spelling ? old.pairs().get(word).word().strip().equalsIgnoreCase(request.spelling().strip()) : word == meaning;
        var matched = new ArrayList<>(old.matched());
        var mistakes = new LinkedHashSet<>(old.mistakes());
        if (correct) matched.add(word);
        else { mistakes.add(word); mistakes.add(meaning); }
        int streak = correct ? old.streak() + 1 : 0;
        Long finished = matched.size() == old.pairs().size() ? elapsed(old) : null;
        var next = new WordGameState(old.pairs(), old.wordOrder(), old.meaningOrder(), List.copyOf(matched),
                List.copyOf(mistakes), old.attempts() + 1, streak, Math.max(old.bestStreak(), streak),
                old.sourceCount(), old.eligibleCount(), old.startedAt(), finished,
                new LastOperation(operation, request, new Feedback(word, meaning, correct)), mode(old));
        mapper.save(id, json.writeValueAsString(next));
        return view(require(mapper.find(id)));
    }

    private long elapsed(WordGameState state) {
        return state.finishedSeconds() == null
                ? Math.max(0, Duration.between(state.startedAt(), Instant.now()).getSeconds()) : state.finishedSeconds();
    }

    private WordGameEntity require(WordGameEntity row) {
        if (row == null) throw new ApiException(404, "WORD_GAME_NOT_FOUND", "练习不存在，请重新开始。");
        return row;
    }

    private WordGameState state(WordGameEntity row) { return json.readValue(row.payload(), WordGameState.class); }

    private String mode(WordGameState state) {
        // V20 rounds created before spelling mode have no mode field.
        return state.mode() == null ? "matching" : state.mode();
    }

    private SpellingPrompt spellingPrompt(WordGameState state) {
        if (!"spelling".equals(mode(state)) || state.finishedSeconds() != null) return null;
        int id = state.wordOrder().get(state.matched().size());
        Word word = state.pairs().get(id);
        String example = word.example() == null ? null : java.util.regex.Pattern
                .compile(java.util.regex.Pattern.quote(word.word().strip()), java.util.regex.Pattern.CASE_INSENSITIVE | java.util.regex.Pattern.UNICODE_CASE)
                .matcher(word.example()).replaceAll("____");
        return new SpellingPrompt(id, word.meaning(), example);
    }

    private Snapshot view(WordGameEntity row) {
        WordGameState state = state(row);
        return new Snapshot(row.id(), Long.toString(row.batchId()), Long.toString(row.revision()),
                state.sourceCount(), state.eligibleCount(),
                state.wordOrder().stream().map(i -> new Choice(i, state.pairs().get(i).word())).toList(),
                state.meaningOrder().stream().map(i -> new Choice(i, state.pairs().get(i).meaning())).toList(),
                state.matched(), state.attempts(), state.streak(), state.bestStreak(),
                state.mistakes().stream().map(state.pairs()::get).toList(), state.finishedSeconds() != null,
                elapsed(state), state.lastOperation() == null ? null : state.lastOperation().feedback(),
                mode(state), spellingPrompt(state));
    }
}
