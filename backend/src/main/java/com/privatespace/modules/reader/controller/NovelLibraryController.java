package com.privatespace.modules.reader.controller;
import java.util.Map;
import com.privatespace.modules.reader.dto.*;
import com.privatespace.modules.reader.service.NovelLibraryService;
import com.privatespace.modules.note.dto.NoteResponse;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
@RestController
@RequestMapping("/api/v1/reader/library")
public class NovelLibraryController {
    private final NovelLibraryService library;
    public NovelLibraryController(NovelLibraryService library) { this.library=library; }
    @GetMapping public ResponseEntity<NovelLibraryResponse> list() { return ResponseEntity.ok().header("Cache-Control","no-store").body(library.list()); }
    @GetMapping("/files/{id}") public ResponseEntity<NoteResponse> source(@PathVariable String id) { return ResponseEntity.ok().header("Cache-Control","no-store").body(library.source(id)); }
    @PostMapping public Map<String,String> change(@Valid @RequestBody NovelLibraryRequest request,@RequestHeader("Idempotency-Key") String operation) { return library.change(request,operation); }
    @PostMapping("/upload") public Map<String,String> upload(@RequestParam String baseRevision,@RequestParam(defaultValue="") String parentId,@RequestParam String name,@RequestParam MultipartFile file,@RequestHeader("Idempotency-Key") String operation) throws java.io.IOException { return library.upload(baseRevision,parentId,name,file.getBytes(),operation); }
}
