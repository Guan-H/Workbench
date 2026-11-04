package com.privatespace.modules.sync.controller;

import java.security.Principal;
import java.util.Map;
import com.privatespace.modules.note.dto.NoteResponse;
import com.privatespace.modules.note.dto.SyncWriteRequest;
import com.privatespace.modules.sync.service.SyncDeviceService;
import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/sync")
public class SyncController {
    private final SyncDeviceService devices;
    private final com.privatespace.modules.sync.service.SyncConflictService conflicts;
    public SyncController(SyncDeviceService devices, com.privatespace.modules.sync.service.SyncConflictService conflicts) {
        this.devices = devices; this.conflicts = conflicts;
    }

    @GetMapping("/conflict-status")
    public Map<String, Object> conflictStatus(Principal device) { return conflicts.deviceFeed(device.getName()); }

    @PostMapping("/conflict-status")
    public Map<String, Object> conflictStatus(Principal device,
            @RequestHeader("X-Sync-Scope-Version") String scopeVersion,
            @Valid @RequestBody com.privatespace.modules.sync.dto.ConflictStatusRequest request) {
        return conflicts.report(device.getName(), scopeVersion, request);
    }

    @PostMapping("/pair")
    public Map<String, String> pair(@RequestBody Map<String, String> request) { return devices.pair(request.get("code")); }

    @GetMapping("/snapshot")
    public Map<String, Object> snapshot(Principal device) {
        return devices.snapshot(device.getName());
    }

    @GetMapping("/changes")
    public com.privatespace.modules.note.dto.SyncChangePage changes(Principal device,
            @RequestHeader(value = "X-Sync-Scope-Version", required = false) String scopeVersion,
            @RequestParam String after, @RequestParam(required = false) String until,
            @RequestParam(defaultValue = "200") int limit) {
        return devices.changes(device.getName(), scopeVersion, after, until, limit);
    }

    @GetMapping("/snapshot-pages")
    public Map<String, Object> snapshotPage(Principal device,
            @RequestParam(required = false) String snapshot, @RequestParam(required = false) String after,
            @RequestParam(defaultValue = "200") int limit) {
        return devices.snapshotPage(device.getName(), snapshot, after, limit);
    }

    @GetMapping("/files/{id}")
    public ResponseEntity<byte[]> content(@PathVariable String id, @RequestParam String version, Principal device,
            @RequestHeader(value = "X-Sync-Scope-Version", required = false) String scopeVersion) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header("Content-Disposition", "attachment").header("Content-Security-Policy", "default-src 'none'; sandbox")
                .body(devices.readFile(device.getName(), scopeVersion, id, version));
    }

    @PostMapping("/files")
    public NoteResponse write(@Valid @RequestBody SyncWriteRequest request, @RequestHeader("Idempotency-Key") String operation, Principal device,
            @RequestHeader(value = "X-Sync-Scope-Version", required = false) String scopeVersion) {
        return devices.writeFile(device.getName(), scopeVersion, request, operation);
    }

    @PostMapping("/conflict-files")
    public NoteResponse resolve(@Valid @RequestBody SyncWriteRequest request, @RequestHeader("Idempotency-Key") String operation, Principal device,
            @RequestHeader(value = "X-Sync-Scope-Version", required = false) String scopeVersion) {
        return devices.resolveFile(device.getName(), scopeVersion, request, operation);
    }

    @PostMapping("/file-renames")
    public NoteResponse rename(@Valid @RequestBody com.privatespace.modules.note.dto.SyncRenameRequest request,
            @RequestHeader("Idempotency-Key") String operation, Principal device,
            @RequestHeader(value = "X-Sync-Scope-Version", required = false) String scopeVersion) {
        return devices.renameFile(device.getName(), scopeVersion, request, operation);
    }
}
