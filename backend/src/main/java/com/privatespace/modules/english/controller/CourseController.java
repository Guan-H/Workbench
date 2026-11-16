package com.privatespace.modules.english.controller;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.english.dto.CourseDtos.*;
import com.privatespace.modules.english.dto.WordGameDtos;
import com.privatespace.modules.english.service.CourseService;

@RestController
@RequestMapping("/api/v1/home/english/courses")
public class CourseController {
    private final CourseService service;
    public CourseController(CourseService service) { this.service = service; }
    @GetMapping
    public Page list(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "all") String filter) { return service.list(page, filter); }
    @GetMapping("/sentences")
    public SentencePage sentences(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "false") boolean markedOnly) { return service.sentences(page, markedOnly); }
    @GetMapping("/{id}")
    public Detail detail(@PathVariable String id) { return service.detail(id); }
    @PutMapping("/{id}/progress")
    public Detail change(@PathVariable String id, @Valid @RequestBody Change request,
            @RequestHeader("Idempotency-Key") String operation) {
        if (!operation.matches(WordGameDtos.UUID_PATTERN)) {
            throw new ApiException(400, "INVALID_COURSE_OPERATION", "操作编号格式无效。");
        }
        return service.change(id, request, operation);
    }
}
