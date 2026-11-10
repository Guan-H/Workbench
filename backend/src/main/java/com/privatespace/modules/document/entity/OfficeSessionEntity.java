package com.privatespace.modules.document.entity;

public record OfficeSessionEntity(String id, String fileId, long sourceVersion, String sourceObject, long currentVersion, String sourcePath,
        String ownerHash, String state, String pendingSave, String completedSave, String lastDigest, String conflictId,
        String errorCode, boolean valid) {}
