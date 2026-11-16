package com.privatespace.modules.english.controller;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.english.dto.CourseDtos.Detail;
import com.privatespace.modules.english.dto.ReadingDtos.*;
import com.privatespace.modules.english.dto.WordGameDtos;
import com.privatespace.modules.english.service.ReadingImportService;
import com.privatespace.modules.english.service.ReadingSourceService;

@RestController
@RequestMapping("/api/v1/home/english/courses")
public class ReadingImportController {
    private final ReadingImportService importer;
    private final ReadingSourceService sources;
    public ReadingImportController(ReadingImportService importer, ReadingSourceService sources) {
        this.importer = importer; this.sources = sources;
    }
    @PostMapping
    public Detail add(@Valid @RequestBody AddArticle request, @RequestHeader("Idempotency-Key") String operation) {
        if (!operation.matches(WordGameDtos.UUID_PATTERN)) throw new ApiException(400, "INVALID_READING_OPERATION", "操作编号格式无效。");
        return importer.add(request, operation);
    }
    @GetMapping("/sources") public SourceStatus source() { return sources.status(); }
    @PutMapping("/sources/nasa") public SourceStatus configure(@Valid @RequestBody Configure request) { return sources.configure(request); }
    @PostMapping("/sources/nasa/sync") public SourceStatus sync() { return sources.sync(); }
}
