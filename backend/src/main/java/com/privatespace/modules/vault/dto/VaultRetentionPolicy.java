package com.privatespace.modules.vault.dto;

public record VaultRetentionPolicy(boolean enabled, int historyDays, int recycleDays, String serverTime, String trashCutoff) { }
