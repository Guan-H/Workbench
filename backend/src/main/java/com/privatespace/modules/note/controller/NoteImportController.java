package com.privatespace.modules.note.controller;

import java.util.List;
import java.util.Map;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.note.dto.ImportPreviewResponse;
import com.privatespace.modules.note.dto.ImportResultResponse;
import com.privatespace.modules.note.service.NoteImportService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/api/v1/note-imports")
public class NoteImportController {
    private final NoteImportService imports;
    private final int maxFiles;
    private final long maxBytes;
    private final ObjectMapper json;

    public NoteImportController(NoteImportService imports, ObjectMapper json,
            @Value("${private-space.import.max-files:2000}") int maxFiles,
            @Value("${private-space.import.max-bytes:1073741824}") long maxBytes) {
        this.imports = imports;
        this.json = json;
        this.maxFiles = maxFiles;
        this.maxBytes = maxBytes;
    }

    @GetMapping("/limits")
    public Map<String, Long> limits() {
        return Map.of("maxFiles", (long) maxFiles, "maxBytes", maxBytes,
                "maxNoteBytes", 1048576L, "maxAttachmentBytes", 52428800L);
    }

    @PostMapping(value = "/preview", consumes = "multipart/form-data")
    public ImportPreviewResponse preview(@RequestParam(defaultValue = "") String target,
            @RequestParam String paths, @RequestParam List<MultipartFile> files) {
        return imports.preview(target, paths(paths), files);
    }

    @PostMapping(consumes = "multipart/form-data")
    public ImportResultResponse commit(@RequestParam(defaultValue = "") String target,
            @RequestParam String paths, @RequestParam List<MultipartFile> files,
            @RequestParam String fingerprint, @RequestHeader("Idempotency-Key") String operation) {
        return imports.commit(target, paths(paths), files, fingerprint, operation);
    }

    private List<String> paths(String value) {
        try { return List.of(json.readValue(value, String[].class)); }
        catch (RuntimeException exception) { throw new ApiException(400, "INVALID_REQUEST", "导入路径清单格式不正确。"); }
    }
}
