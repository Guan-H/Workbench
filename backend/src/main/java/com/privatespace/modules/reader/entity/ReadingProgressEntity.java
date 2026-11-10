package com.privatespace.modules.reader.entity;

public record ReadingProgressEntity(long revision, String sourceHash, String format, String locator,
        String operation, String requestHash, String updatedAt) {
}
