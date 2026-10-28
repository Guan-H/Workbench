package com.privatespace.modules.note.entity;

import java.time.LocalDateTime;

public record NoteFileEntity(String id, String path, String type, long version, String objectId,
        String content, boolean deleted, boolean favorite, LocalDateTime lastOpenedAt,
        LocalDateTime updatedAt, long size, String sha256) {
}
