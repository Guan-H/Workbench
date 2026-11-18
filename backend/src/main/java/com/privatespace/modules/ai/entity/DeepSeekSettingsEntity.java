package com.privatespace.modules.ai.entity;

public record DeepSeekSettingsEntity(long revision, String providerName, String models, byte[] encryptedKey) {}
