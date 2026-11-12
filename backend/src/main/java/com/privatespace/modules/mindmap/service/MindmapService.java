package com.privatespace.modules.mindmap.service;

import com.privatespace.modules.mindmap.dto.MindmapDtos.*;

public interface MindmapService {
    Page list(boolean deleted, String query, int page);
    Snapshot read(String id);
    Saved save(String id, Write request, String operation);
    Saved deleted(String id, Version request, boolean deleted, String operation);
}
