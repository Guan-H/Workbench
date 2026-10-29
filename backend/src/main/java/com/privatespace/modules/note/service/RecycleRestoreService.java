package com.privatespace.modules.note.service;

import com.privatespace.modules.note.dto.*;

/** Restores a reviewed subset of persistent recycle snapshots without overwriting live or recycled paths. */
public interface RecycleRestoreService {
    RecycleCandidatesResponse candidates(String id);
    RecycleRestorePreview preview(String id, RecycleRestoreRequest request);
    RecycleRestoreResult restore(String id, RecycleRestoreRequest request, String operation);
}
