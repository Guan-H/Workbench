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
    public FileController(NoteService notes) { this.notes = notes; }

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
