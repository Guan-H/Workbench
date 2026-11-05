package com.privatespace.modules.vault.controller;

import com.privatespace.modules.vault.dto.CreateVaultRequest;
import com.privatespace.modules.vault.dto.ChangeVaultMasterPasswordRequest;
import com.privatespace.modules.vault.dto.UpdateVaultRequest;
import com.privatespace.modules.vault.dto.VaultResponse;
import com.privatespace.modules.vault.service.VaultService;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Authenticated ciphertext storage only; this API never receives a master password. */
@RestController
@RequestMapping("/api/v1/vault")
public class VaultController {
    private final VaultService service;
    public VaultController(VaultService service) { this.service = service; }

    @GetMapping
    public ResponseEntity<VaultResponse> read() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.read());
    }

    @PostMapping
    public ResponseEntity<VaultResponse> create(@Valid @RequestBody CreateVaultRequest request,
            @RequestHeader("Idempotency-Key") String operation) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.create(request, operation));
    }

    @PutMapping("/master-password")
    public ResponseEntity<VaultResponse> changeMasterPassword(@Valid @RequestBody ChangeVaultMasterPasswordRequest request,
            @RequestHeader("Idempotency-Key") String operation) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.changeMasterPassword(request, operation));
    }

    @PutMapping
    public ResponseEntity<VaultResponse> save(@Valid @RequestBody UpdateVaultRequest request,
            @RequestHeader("Idempotency-Key") String operation) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.save(request, operation));
    }
}
