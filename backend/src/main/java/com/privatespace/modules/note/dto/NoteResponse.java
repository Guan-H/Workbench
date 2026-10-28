package com.privatespace.modules.note.dto;

public record NoteResponse(String id, String path, String type, String version, String content,
        boolean deleted, boolean favorite, String lastOpenedAt, String updatedAt, long size, String sha256) {
}
