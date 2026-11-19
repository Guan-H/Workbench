package com.privatespace.modules.ai.entity;

public record AiConnectionEntity(String id, String providerId, long revision, long credentialRevision,
                                 String providerName, String models, byte[] encryptedKey, String baseUrl) {}
