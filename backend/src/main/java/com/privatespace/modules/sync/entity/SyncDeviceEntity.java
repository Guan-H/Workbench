package com.privatespace.modules.sync.entity;

import java.time.LocalDateTime;

public record SyncDeviceEntity(String id, String name, boolean revoked, LocalDateTime createdAt, LocalDateTime lastSeenAt) { }
