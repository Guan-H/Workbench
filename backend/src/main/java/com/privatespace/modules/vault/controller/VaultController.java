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
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import com.privatespace.modules.vault.dto.VaultHistoryPage;
import com.privatespace.modules.vault.dto.VaultRetentionPolicy;
import com.privatespace.modules.vault.service.VaultRetentionService;
import com.privatespace.modules.vault.dto.VaultRecoveryResponse;
import com.privatespace.modules.vault.dto.ConfigureVaultRecoveryRequest;
import com.privatespace.modules.vault.dto.ResetVaultMasterRequest;

/** Authenticated ciphertext storage only; this API never receives a master password. */
@RestController
@RequestMapping("/api/v1/vault")
public class VaultController {
    private final VaultService service;
    private final VaultRetentionService retention;
    public VaultController(VaultService service, VaultRetentionService retention) { this.service = service; this.retention = retention; }

    @GetMapping("/recovery")
    public ResponseEntity<VaultRecoveryResponse> recovery() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.recovery());
    }

    @PutMapping("/recovery")
    public ResponseEntity<VaultResponse> configureRecovery(@Valid @RequestBody ConfigureVaultRecoveryRequest request,
            @RequestHeader("Idempotency-Key") String operation) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.configureRecovery(request, operation));
    }

    @PutMapping("/recovery/reset-master-password")
    public ResponseEntity<VaultResponse> resetMaster(@Valid @RequestBody ResetVaultMasterRequest request,
            @RequestHeader("Idempotency-Key") String operation) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.resetMaster(request, operation));
    }

    @GetMapping("/history")
    public ResponseEntity<VaultHistoryPage> history(@RequestParam(defaultValue = "1") int page, @RequestParam(required = false) String anchor) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.history(page, anchor));
    }

    @GetMapping("/history/{version}")
    public ResponseEntity<VaultResponse> historical(@PathVariable String version) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.historical(version));
    }

    @GetMapping("/retention")
    public ResponseEntity<VaultRetentionPolicy> retention() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(retention.policy());
    }

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
