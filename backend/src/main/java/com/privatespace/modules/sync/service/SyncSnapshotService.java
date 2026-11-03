package com.privatespace.modules.sync.service;

import java.util.Map;
import com.privatespace.modules.sync.dto.SyncDeviceResponse;

/** Creates and reads a fixed metadata view; device authorization remains with SyncDeviceService. */
public interface SyncSnapshotService {
    /**
     * Starts a new view when snapshot is null; otherwise reads positions after the supplied ordinal.
     * Requires the caller's device lock and transaction. Expired, replaced or foreign tokens fail closed.
     */
    Map<String, Object> page(SyncDeviceResponse device, String snapshot, String after, int limit);
}
