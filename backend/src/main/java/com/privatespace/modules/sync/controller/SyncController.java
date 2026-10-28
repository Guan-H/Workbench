package com.privatespace.modules.sync.controller;

import java.security.Principal;
import java.util.Map;
import com.privatespace.modules.note.dto.NoteResponse;
import com.privatespace.modules.note.service.NoteService;
import com.privatespace.modules.note.dto.SyncWriteRequest;
import com.privatespace.modules.sync.service.SyncDeviceService;
import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/sync")
public class SyncController {
    private final NoteService notes;
    private final SyncDeviceService devices;
    public SyncController(NoteService notes, SyncDeviceService devices) { this.notes = notes; this.devices = devices; }

    @PostMapping("/pair")
    public Map<String, String> pair(@RequestBody Map<String, String> request) { return devices.pair(request.get("code")); }

    @GetMapping("/snapshot")
    public Map<String, Object> snapshot() { return notes.syncSnapshot(); }

    @GetMapping("/files/{id}")
    public ResponseEntity<byte[]> content(@PathVariable String id, @RequestParam String version) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header("Content-Disposition", "attachment").header("Content-Security-Policy", "default-src 'none'; sandbox")
                .body(notes.syncRead(id, version));
    }

    @PostMapping("/files")
    public NoteResponse write(@Valid @RequestBody SyncWriteRequest request, @RequestHeader("Idempotency-Key") String operation, Principal device) {
        return notes.syncWrite(request, operation, device.getName());
    }
}
