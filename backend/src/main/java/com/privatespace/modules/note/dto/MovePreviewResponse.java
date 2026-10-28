package com.privatespace.modules.note.dto;

import java.util.List;

public record MovePreviewResponse(String fingerprint, String fromPath, String toPath,
        List<Change> changes, List<String> warnings) {
    public record Change(String id, String fromPath, String toPath, String baseVersion,
            List<LinkChange> links) { }
    public record LinkChange(int line, String from, String to) { }
}
