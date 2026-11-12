package com.privatespace.modules.english.controller;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.english.dto.StudyDtos.*;
import com.privatespace.modules.english.service.StudyService;

@RestController
@RequestMapping("/api/v1/home/english/study")
public class StudyController {
    private final StudyService study;
    public StudyController(StudyService study) { this.study=study; }
    @GetMapping public Dashboard dashboard() { return study.dashboard(); }
    @PutMapping("/settings") public Settings settings(@Valid @RequestBody ChangeSettings request) { return study.settings(request); }
    @GetMapping("/items") public Items items(@RequestParam(defaultValue="word") String kind,@RequestParam(defaultValue="") String query,
            @RequestParam(defaultValue="false") boolean wrong,@RequestParam(defaultValue="1") int page) { return study.items(kind,query,wrong,page); }
    @PostMapping("/plans") public Plan plan(@RequestHeader("Idempotency-Key") String operation) { return study.createPlan(identifier(operation)); }
    @GetMapping("/plans/{id}") public Plan plan(@PathVariable long id) { return study.plan(id); }
    @PutMapping("/tasks/{id}") public Task translation(@PathVariable String id,@Valid @RequestBody SaveTranslation request,
            @RequestHeader("Idempotency-Key") String operation) { return study.translation(identifier(id),request,identifier(operation)); }
    private String identifier(String value) {
        if(!value.matches(com.privatespace.modules.english.dto.WordGameDtos.UUID_PATTERN)) throw new ApiException(400,"INVALID_STUDY_ID","操作编号格式无效。");
        return value;
    }
}
