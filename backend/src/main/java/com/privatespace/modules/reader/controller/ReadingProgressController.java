package com.privatespace.modules.reader.controller;

import com.privatespace.modules.reader.dto.ReadingProgressRequest;
import com.privatespace.modules.reader.dto.ReadingProgressResponse;
import com.privatespace.modules.reader.service.ReadingProgressService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/reader/files/{id}/progress")
public class ReadingProgressController {
    private final ReadingProgressService progress;

    public ReadingProgressController(ReadingProgressService progress) { this.progress = progress; }

    @GetMapping
    public ResponseEntity<ReadingProgressResponse> read(@PathVariable String id) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(progress.read(id));
    }

    @PutMapping
    public ResponseEntity<ReadingProgressResponse> save(@PathVariable String id, @Valid @RequestBody ReadingProgressRequest request,
            @RequestHeader("Idempotency-Key") String operation) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(progress.save(id, request, operation));
    }
}
