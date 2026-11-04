package com.privatespace.modules.sync.entity;

import java.time.LocalDateTime;

public record ConflictStatusEntity(String path, long revision, String metadataJson, long scopeVersion, LocalDateTime reportedAt) { }
