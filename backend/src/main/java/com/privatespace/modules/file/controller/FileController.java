package com.privatespace.modules.file.controller;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;

import com.privatespace.modules.note.dto.NoteResponse;
import com.privatespace.modules.note.service.NoteService;
import org.springframework.http.ContentDisposition;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/files")
public class FileController {
    private final NoteService notes;
    private final com.privatespace.modules.file.service.TextFileService texts;
    public FileController(NoteService notes, com.privatespace.modules.file.service.TextFileService texts) { this.notes = notes; this.texts = texts; }

    @GetMapping("/{id}/content")
    public ResponseEntity<byte[]> versionContent(@PathVariable String id, @RequestParam String version) {
        return ResponseEntity.ok().header("Content-Type", "application/octet-stream").header("Cache-Control", "no-store")
                .header("X-Content-Type-Options", "nosniff").header("Content-Disposition", "attachment")
                .header("Content-Security-Policy", "default-src 'none'; sandbox").body(notes.versionBytes(id, version));
    }

    @GetMapping("/{id}/text")
    public ResponseEntity<java.util.Map<String, Object>> text(@PathVariable String id, @RequestParam(defaultValue = "auto") String encoding) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(texts.read(id, encoding));
    }

    @PutMapping("/{id}/text")
    public NoteResponse saveText(@PathVariable String id, @jakarta.validation.Valid @RequestBody com.privatespace.modules.file.dto.TextFileRequest request,
            @RequestHeader("Idempotency-Key") String operation) { return texts.save(id, request, operation); }

    @PostMapping
    public NoteResponse upload(@RequestParam String path, @RequestParam MultipartFile file,
            @RequestHeader("Idempotency-Key") String operation) throws java.io.IOException {
        return notes.upload(path, file.getBytes(), operation);
    }

    @GetMapping("/content")
    public ResponseEntity<byte[]> content(@RequestParam String path) {
        byte[] content = notes.download(path);
        String prefix = HexFormat.of().formatHex(content, 0, Math.min(content.length, 12));
        String type = "application/octet-stream";
        if (prefix.startsWith("89504e470d0a1a0a")) type = "image/png";
        else if (prefix.startsWith("ffd8ff")) type = "image/jpeg";
        else if (prefix.startsWith("52494646") && prefix.endsWith("57454250")) type = "image/webp";
        boolean image = type.startsWith("image/");
        return ResponseEntity.ok().header("Content-Type", type).header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "default-src 'none'; sandbox")
                .header("Content-Disposition", (image ? ContentDisposition.inline() : ContentDisposition.attachment())
                        .filename(path.substring(path.lastIndexOf('/') + 1), StandardCharsets.UTF_8).build().toString())
                .body(content);
    }
}
