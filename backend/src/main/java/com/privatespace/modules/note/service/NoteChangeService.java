package com.privatespace.modules.note.service;

import java.time.LocalDateTime;
import java.util.List;
import com.privatespace.modules.note.dto.SyncChangePage;

/** Immutable sync metadata and its retained cursor boundary; callers own the write transaction. */
public interface NoteChangeService {
    void publish(String id);
    void purge(com.privatespace.modules.note.entity.NoteFileEntity file);
    List<com.privatespace.modules.note.dto.NoteResponse> retainedTombstones();
    SyncChangePage changes(String after, String until, int limit, List<String> folders, List<String> attachments);
    void prune(LocalDateTime cutoff, int limit);
}
