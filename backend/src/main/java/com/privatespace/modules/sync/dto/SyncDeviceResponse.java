package com.privatespace.modules.sync.dto;

public record SyncDeviceResponse(String id, String name, boolean revoked, String createdAt, String lastSeenAt) { }
