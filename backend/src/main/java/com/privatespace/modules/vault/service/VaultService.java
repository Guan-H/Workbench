package com.privatespace.modules.vault.service;

import com.privatespace.modules.vault.dto.CreateVaultRequest;
import com.privatespace.modules.vault.dto.VaultResponse;
import com.privatespace.modules.vault.dto.ChangeVaultMasterPasswordRequest;
import com.privatespace.modules.vault.dto.UpdateVaultRequest;
import com.privatespace.modules.vault.dto.VaultHistoryPage;
import com.privatespace.modules.vault.dto.VaultRecoveryResponse;
import com.privatespace.modules.vault.dto.ConfigureVaultRecoveryRequest;
import com.privatespace.modules.vault.dto.ResetVaultMasterRequest;

public interface VaultService {
    VaultRecoveryResponse recovery();
    VaultResponse configureRecovery(ConfigureVaultRecoveryRequest request, String operation);
    VaultResponse resetMaster(ResetVaultMasterRequest request, String operation);
    VaultHistoryPage history(int page, String anchor);
    VaultResponse historical(String version);
    VaultResponse read();
    VaultResponse create(CreateVaultRequest request, String operation);
    VaultResponse changeMasterPassword(ChangeVaultMasterPasswordRequest request, String operation);
    VaultResponse save(UpdateVaultRequest request, String operation);
}
