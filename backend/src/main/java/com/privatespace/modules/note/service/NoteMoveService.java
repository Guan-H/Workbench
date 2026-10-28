package com.privatespace.modules.note.service;

import com.privatespace.modules.note.dto.MoveNoteRequest;
import com.privatespace.modules.note.dto.MovePreviewResponse;
import com.privatespace.modules.note.dto.NoteResponse;

/** Previews and atomically applies path/link changes, rejecting any stale preview. */
public interface NoteMoveService {
    MovePreviewResponse preview(String id, MoveNoteRequest request);
    NoteResponse move(String id, MoveNoteRequest request, String operation);
}
