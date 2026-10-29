package com.privatespace.modules.note.dto;

import java.util.List;

public record ImportPreviewResponse(String fingerprint, boolean canImport, long totalBytes,
        int fileCount, List<Entry> entries) {
    public record Entry(String path, String type, long size, String status, String message) { }
}
