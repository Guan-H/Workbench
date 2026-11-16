package com.privatespace.modules.english.entity;

import java.time.LocalDateTime;

public record ReadingSourceEntity(String id, long revision, boolean enabled, LocalDateTime runningSince,
        LocalDateTime lastAttemptAt, LocalDateTime lastSuccessAt, LocalDateTime retryAfterAt, int lastAdded, int lastSkipped, String lastError) {}
