package com.privatespace.modules.note.dto;

import java.util.List;

public record RecycleRestorePreview(String fingerprint, List<Change> changes, List<Folder> folders, List<String> warnings) {
    public record Change(String id, String fromPath, String toPath, String type, List<MovePreviewResponse.LinkChange> links) { }
    public record Folder(String path, String action) { }
}
