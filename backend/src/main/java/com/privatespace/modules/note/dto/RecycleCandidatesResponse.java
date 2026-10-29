package com.privatespace.modules.note.dto;

import java.util.List;

public record RecycleCandidatesResponse(String id, String path, String baseVersion, List<Item> items) {
    public record Item(String id, String path, String type) { }
}
