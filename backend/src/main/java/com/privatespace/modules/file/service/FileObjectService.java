package com.privatespace.modules.file.service;

import java.time.Instant;

import com.privatespace.modules.file.entity.FileObjectEntity;

/** Immutable private object IO; callers publish references only in a database transaction. */
public interface FileObjectService {
    FileObjectEntity write(byte[] content);
    byte[] read(String id);
    void lease(String id, String leaseId, Instant expires);
    boolean deleteIfUnreferenced(String id);
    int deletePhysicalOrphans(Instant cutoff);
}
