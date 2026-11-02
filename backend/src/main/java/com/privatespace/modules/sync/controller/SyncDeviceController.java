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
    public Map<String, String> pairing(@RequestBody com.privatespace.modules.sync.dto.PairingRequest request) { return service.pairing(request.name(), request.scope()); }
    public record ScopeRequest(com.privatespace.modules.sync.dto.SyncScope scope, String baseVersion) {}
    @PutMapping("/{id}/scope")
    public SyncDeviceResponse scope(@PathVariable String id, @RequestBody ScopeRequest request) {
        if (request.scope() == null) throw new com.privatespace.common.exception.ApiException(400, "INVALID_SCOPE", "请选择同步范围。");
        return service.updateScope(id, request.scope(), request.baseVersion());
    }
    @GetMapping
    public List<SyncDeviceResponse> list() { return service.list(); }
    @DeleteMapping("/{id}")
    public Map<String, Boolean> revoke(@PathVariable String id) { service.revoke(id); return Map.of("revoked", true); }
}
