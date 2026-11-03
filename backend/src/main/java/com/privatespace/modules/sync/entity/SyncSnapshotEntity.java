package com.privatespace.modules.sync.entity;

/** The persisted header of one device's immutable, short-lived metadata view. */
public record SyncSnapshotEntity(String id, long scopeVersion, String metadataJson, long itemCount) {}
