package com.privatespace.modules.sync.entity;

import java.time.LocalDateTime;

public record SyncActivityEntity(long revision, String statusJson, long scopeVersion, LocalDateTime reportedAt) { }
