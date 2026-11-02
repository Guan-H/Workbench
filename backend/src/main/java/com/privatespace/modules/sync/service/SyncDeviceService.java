package com.privatespace.modules.sync.service;

import java.util.List;
import java.util.Map;
import com.privatespace.modules.sync.dto.SyncDeviceResponse;
import com.privatespace.modules.note.dto.NoteResponse;
import com.privatespace.modules.note.dto.SyncWriteRequest;

public interface SyncDeviceService {
    Map<String, String> pairing(String name);
    Map<String, String> pairing(String name, com.privatespace.modules.sync.dto.SyncScope scope);
    Map<String, String> pair(String code);
    String authenticate(String token);
    List<SyncDeviceResponse> list();
    void revoke(String id);
    SyncDeviceResponse current(String id);
    SyncDeviceResponse updateScope(String id, com.privatespace.modules.sync.dto.SyncScope scope, String version);
    Map<String, Object> snapshot(String deviceId);
    byte[] readFile(String deviceId, String scopeVersion, String id, String version);
    NoteResponse writeFile(String deviceId, String scopeVersion, SyncWriteRequest request, String operation);
}
