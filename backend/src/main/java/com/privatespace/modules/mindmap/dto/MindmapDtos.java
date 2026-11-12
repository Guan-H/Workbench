package com.privatespace.modules.mindmap.dto;

import java.util.List;
import tools.jackson.databind.JsonNode;

/** Plaintext diagram contracts. List responses deliberately omit documents. */
public final class MindmapDtos {
    private MindmapDtos() {}
    public record Snapshot(String id, String title, String version, JsonNode document, boolean deleted, String updatedAt) {}
    public record Page(List<Snapshot> items, long total, int page) {}
    public record Write(String baseVersion, String title, JsonNode document) {}
    public record Version(String baseVersion) {}
    public record Saved(String id, String version, boolean deleted, String updatedAt) {}
}
