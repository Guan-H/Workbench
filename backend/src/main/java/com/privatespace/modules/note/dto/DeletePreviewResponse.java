package com.privatespace.modules.note.dto;

import java.util.List;

public record DeletePreviewResponse(String fingerprint, List<Target> targets) {
    public record Target(String id, String path, String type, String version) { }
}
