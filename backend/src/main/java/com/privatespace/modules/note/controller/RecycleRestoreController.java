package com.privatespace.modules.note.controller;

import com.privatespace.modules.note.dto.*;
import com.privatespace.modules.note.service.RecycleRestoreService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/recycle/{id}")
public class RecycleRestoreController {
    private final RecycleRestoreService service;

    public RecycleRestoreController(RecycleRestoreService service) { this.service = service; }

    @GetMapping
    public RecycleCandidatesResponse candidates(@PathVariable String id) { return service.candidates(id); }

    @PostMapping("/preview")
    public RecycleRestorePreview preview(@PathVariable String id, @RequestBody RecycleRestoreRequest request) {
        return service.preview(id, request);
    }

    @PostMapping("/restore")
    public RecycleRestoreResult restore(@PathVariable String id, @RequestBody RecycleRestoreRequest request,
            @RequestHeader("Idempotency-Key") String operation) {
        return service.restore(id, request, operation);
    }
}
