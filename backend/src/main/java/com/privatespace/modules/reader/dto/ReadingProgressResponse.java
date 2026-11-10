package com.privatespace.modules.reader.dto;

public record ReadingProgressResponse(String revision, String sourceHash, String format, String locator,
        String operation, String updatedAt) {
}
