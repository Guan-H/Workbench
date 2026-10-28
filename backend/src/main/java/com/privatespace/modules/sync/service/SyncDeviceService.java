package com.privatespace.modules.sync.service;

import java.util.List;
import java.util.Map;
import com.privatespace.modules.sync.dto.SyncDeviceResponse;

public interface SyncDeviceService {
    Map<String, String> pairing(String name);
    Map<String, String> pair(String code);
    String authenticate(String token);
    List<SyncDeviceResponse> list();
    void revoke(String id);
}
