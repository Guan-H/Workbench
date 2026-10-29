package com.privatespace.modules.note.entity;

public record DeleteMemberEntity(String rootId, long rootDeletedVersion, String fileId,
        long beforeVersion, long deletedVersion, String path) { }
