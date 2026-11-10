package com.privatespace.modules.document.controller;

import java.util.Map;
import com.privatespace.modules.document.service.OfficeService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

/** No browser login bypass: each bridge action validates a bounded signed document credential. */
@RestController
@RequestMapping("/api/v1/office-bridge")
public class OfficeBridgeController {
    private final OfficeService service;
    public OfficeBridgeController(OfficeService service) { this.service=service; }
    @GetMapping("/{id}/source")
    public ResponseEntity<byte[]> source(@PathVariable String id,@RequestParam String ticket) {
        return ResponseEntity.ok().header("Cache-Control","no-store").header("Content-Type","application/octet-stream")
                .header("Content-Disposition","attachment").header("X-Content-Type-Options","nosniff")
                .header("Content-Security-Policy","default-src 'none'; sandbox").body(service.source(id,ticket));
    }
    @PostMapping("/{id}/callback")
    public Map<String,Integer> callback(@PathVariable String id,@RequestBody JsonNode body,@RequestHeader(value="Authorization",required=false) String authorization) {
        return service.callback(id,body,authorization);
    }
}
