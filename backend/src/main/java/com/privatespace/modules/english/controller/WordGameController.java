package com.privatespace.modules.english.controller;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.english.dto.WordGameDtos.*;
import com.privatespace.modules.english.service.WordGameService;

@RestController
@RequestMapping("/api/v1/home/english/word-games")
public class WordGameController {
    private final WordGameService service;
    public WordGameController(WordGameService service) { this.service = service; }

    @PostMapping
    public Snapshot create(@Valid @RequestBody Create request,
            @RequestHeader("Idempotency-Key") String operation) {
        return service.create(request, identifier(operation));
    }

    @GetMapping("/{id}")
    public Snapshot read(@PathVariable String id) {
        return service.read(identifier(id));
    }

    @PostMapping("/{id}/answers")
    public Snapshot answer(@PathVariable String id,
            @Valid @RequestBody Answer request,
            @RequestHeader("Idempotency-Key") String operation) {
        return service.answer(identifier(id), request, identifier(operation));
    }

    private String identifier(String value) {
        if (!value.matches(com.privatespace.modules.english.dto.WordGameDtos.UUID_PATTERN)) {
            throw new ApiException(400, "INVALID_WORD_GAME_ID", "练习编号或操作编号格式不正确。");
        }
        return value;
    }
}
