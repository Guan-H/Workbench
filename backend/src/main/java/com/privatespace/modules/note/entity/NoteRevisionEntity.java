package com.privatespace.modules.note.entity;

import java.time.LocalDateTime;

public record NoteRevisionEntity(String fileId, long version, String objectId, String path,
        boolean deleted, LocalDateTime createdAt) {
}
