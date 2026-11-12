package com.privatespace.modules.mindmap.entity;

import java.time.LocalDateTime;

public record MindmapEntity(String id, String title, long version, String document, boolean deleted, LocalDateTime updatedAt) {}
