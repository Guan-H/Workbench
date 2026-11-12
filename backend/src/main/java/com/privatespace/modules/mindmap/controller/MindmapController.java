package com.privatespace.modules.mindmap.controller;

import com.privatespace.modules.mindmap.dto.MindmapDtos.*;
import com.privatespace.modules.mindmap.service.MindmapService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/mindmaps")
public class MindmapController {
    private final MindmapService service;
    public MindmapController(MindmapService service) { this.service = service; }
    @GetMapping public Page list(@RequestParam(defaultValue = "false") boolean deleted, @RequestParam(defaultValue = "") String query, @RequestParam(defaultValue = "1") int page) { return service.list(deleted, query, page); }
    @GetMapping("/{id}") public Snapshot read(@PathVariable String id) { return service.read(id); }
    @PutMapping("/{id}") public Saved save(@PathVariable String id, @RequestBody Write request, @RequestHeader("Idempotency-Key") String operation) { return service.save(id, request, operation); }
    @PostMapping("/{id}/delete") public Saved delete(@PathVariable String id, @RequestBody Version request, @RequestHeader("Idempotency-Key") String operation) { return service.deleted(id, request, true, operation); }
    @PostMapping("/{id}/restore") public Saved restore(@PathVariable String id, @RequestBody Version request, @RequestHeader("Idempotency-Key") String operation) { return service.deleted(id, request, false, operation); }
}
