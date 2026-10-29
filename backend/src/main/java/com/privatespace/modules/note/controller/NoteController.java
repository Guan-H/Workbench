package com.privatespace.modules.note.controller;

import java.util.List;
import java.util.Map;

import com.privatespace.modules.note.dto.NoteResponse;
import com.privatespace.modules.note.dto.WriteNoteRequest;
import com.privatespace.modules.note.dto.MoveNoteRequest;
import com.privatespace.modules.note.dto.MovePreviewResponse;
import com.privatespace.modules.note.service.NoteMoveService;
import com.privatespace.modules.note.service.NoteService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/notes")
public class NoteController {
    private final NoteService service;
    private final NoteMoveService moves;
    public NoteController(NoteService service, NoteMoveService moves) { this.service = service; this.moves = moves; }

    @PostMapping("/{id}/move-preview")
    public MovePreviewResponse previewMove(@PathVariable String id, @Valid @RequestBody MoveNoteRequest request) {
        return moves.preview(id, request);
    }

    @PostMapping("/{id}/move")
    public NoteResponse move(@PathVariable String id, @Valid @RequestBody MoveNoteRequest request, @RequestHeader("Idempotency-Key") String operation) {
        return moves.move(id, request, operation);
    }

    @GetMapping
    public Map<String, Object> list(@RequestParam(defaultValue = "false") boolean deleted,
            @RequestParam(defaultValue = "") String cursor, @RequestParam(defaultValue = "") String query,
            @RequestParam(defaultValue = "false") boolean includeGroups) {
        return service.list(deleted, cursor, query, includeGroups);
    }

    @GetMapping("/{id}")
    public NoteResponse read(@PathVariable String id) { return service.read(id, true); }

    @PostMapping
    public NoteResponse create(@Valid @RequestBody WriteNoteRequest request, @RequestHeader("Idempotency-Key") String operation) {
        return service.create(request, operation);
    }

    @PutMapping("/{id}")
    public NoteResponse save(@PathVariable String id, @Valid @RequestBody WriteNoteRequest request, @RequestHeader("Idempotency-Key") String operation) {
        return service.save(id, request, operation);
    }

    @DeleteMapping("/{id}")
    public NoteResponse delete(@PathVariable String id, @RequestParam String baseVersion,
            @RequestParam(required = false) String fingerprint, @RequestHeader("Idempotency-Key") String operation) {
        return service.delete(id, baseVersion, operation, fingerprint);
    }

    @GetMapping("/{id}/delete-preview")
    public com.privatespace.modules.note.dto.DeletePreviewResponse deletePreview(@PathVariable String id, @RequestParam String baseVersion) {
        return service.deletePreview(id, baseVersion);
    }

    @GetMapping("/{id}/history")
    public List<Map<String, Object>> history(@PathVariable String id) { return service.history(id); }

    @GetMapping("/{id}/history/{version}")
    public NoteResponse revision(@PathVariable String id, @PathVariable String version) { return service.revision(id, version); }

    @PostMapping("/{id}/restore")
    public NoteResponse restore(@PathVariable String id, @RequestParam String version, @RequestParam String baseVersion,
            @RequestHeader("Idempotency-Key") String operation) { return service.restore(id, version, baseVersion, operation); }

    @PutMapping("/{id}/favorite")
    public Map<String, Boolean> favorite(@PathVariable String id, @RequestParam boolean value) {
        service.favorite(id, value);
        return Map.of("favorite", value);
    }
}
