package com.privatespace.modules.sync.controller;

import java.util.List;
import java.util.Map;
import com.privatespace.modules.sync.service.SyncDeviceService;
import com.privatespace.modules.sync.dto.SyncDeviceResponse;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/sync-devices")
public class SyncDeviceController {
    private final SyncDeviceService service;
    public SyncDeviceController(SyncDeviceService service) { this.service = service; }

    @PostMapping("/pairing-code")
    public Map<String, String> pairing(@RequestBody Map<String, String> request) { return service.pairing(request.get("name")); }
    @GetMapping
    public List<SyncDeviceResponse> list() { return service.list(); }
    @DeleteMapping("/{id}")
    public Map<String, Boolean> revoke(@PathVariable String id) { service.revoke(id); return Map.of("revoked", true); }
}
