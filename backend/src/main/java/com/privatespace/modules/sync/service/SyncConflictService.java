package com.privatespace.modules.sync.service;

import java.util.Map;
import com.privatespace.modules.sync.dto.ConflictStatusRequest;

public interface SyncConflictService {
    Map<String, Object> report(String device, String scopeVersion, ConflictStatusRequest request);
    Map<String, Object> deviceFeed(String device);
    Map<String, Object> page(String device, String after, int limit, String state);
    Map<String, Object> activity(String device, String after, int limit);
}
