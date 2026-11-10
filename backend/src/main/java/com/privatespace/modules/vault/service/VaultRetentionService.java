package com.privatespace.modules.vault.service;

import com.privatespace.modules.vault.dto.VaultRetentionPolicy;

public interface VaultRetentionService {
    VaultRetentionPolicy policy();
    int cleanup();
}
