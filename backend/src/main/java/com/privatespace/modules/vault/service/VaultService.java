package com.privatespace.modules.vault.service;

import com.privatespace.modules.vault.dto.CreateVaultRequest;
import com.privatespace.modules.vault.dto.VaultResponse;
import com.privatespace.modules.vault.dto.ChangeVaultMasterPasswordRequest;
import com.privatespace.modules.vault.dto.UpdateVaultRequest;

public interface VaultService {
    VaultResponse read();
    VaultResponse create(CreateVaultRequest request, String operation);
    VaultResponse changeMasterPassword(ChangeVaultMasterPasswordRequest request, String operation);
    VaultResponse save(UpdateVaultRequest request, String operation);
}
