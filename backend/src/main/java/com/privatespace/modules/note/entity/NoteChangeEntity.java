package com.privatespace.modules.note.entity;

public record NoteChangeEntity(long sequenceId, String fileId, String metadataJson, String beforePath,
        boolean referencesChanged, boolean purged) { }
