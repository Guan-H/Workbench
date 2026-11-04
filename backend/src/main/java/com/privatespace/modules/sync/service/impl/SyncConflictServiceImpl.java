package com.privatespace.modules.sync.service.impl;

import java.util.*;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.note.service.NotePaths;
import com.privatespace.modules.note.service.NoteService;
import com.privatespace.modules.sync.dto.ConflictStatusRequest;
import com.privatespace.modules.sync.mapper.SyncConflictMapper;
import com.privatespace.modules.sync.service.SyncConflictService;
import com.privatespace.modules.sync.service.SyncDeviceService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** Store versioned observations independently of actual file/conflict resolution. */
@Service
public class SyncConflictServiceImpl implements SyncConflictService {
    private final SyncConflictMapper mapper;
    private final SyncDeviceService devices;
    private final NoteService notes;
    private final ObjectMapper json;
    public SyncConflictServiceImpl(SyncConflictMapper mapper, SyncDeviceService devices, NoteService notes, ObjectMapper json) {
        this.mapper = mapper; this.devices = devices; this.notes = notes; this.json = json;
    }

    @Transactional
    public Map<String, Object> report(String device, String scopeVersion, ConflictStatusRequest request) {
        var current = devices.current(device);
        if (!current.scopeVersion().equals(scopeVersion)) throw new ApiException(409, "SYNC_SCOPE_CHANGED", "同步范围已变化，请重新核对后上报。");
        long revision = Long.parseLong(request.revision());
        var paths = new HashSet<String>();
        var attachments = current.scope().all() ? List.<String>of() : notes.syncAttachmentPaths(current.scope().folders());
        for (var item : request.items()) {
            String path = NotePaths.validate(item.path());
            if (!paths.add(path)) throw new ApiException(400, "INVALID_REQUEST", "同批上报路径不能重复。");
            if (!current.scope().all() && current.scope().folders().stream().noneMatch(root -> path.startsWith(root + "/")) && !attachments.contains(path)) {
                throw new ApiException(403, "OUTSIDE_SYNC_SCOPE", "不能上报设备范围外的文件。");
            }
            if (item.localState().equals("present") != (item.localSha256() != null)) throw new ApiException(400, "INVALID_REQUEST", "本地状态与摘要不一致。");
            var old = mapper.item(device, path);
            if (old != null && old.revision() >= revision) {
                if (old.revision() != revision || old.scopeVersion() != Long.parseLong(scopeVersion)
                        || !json.readValue(old.metadataJson(), ConflictStatusRequest.Item.class).equals(item)) {
                    throw new ApiException(409, "CONFLICT_REPORT_STALE", "状态上报版本已变化，请重新读取后上报。");
                }
                continue;
            }
            mapper.save(device, path, revision, item.active(), json.writeValueAsString(item), Long.parseLong(scopeVersion));
        }
        mapper.updateFeed(device, revision, Long.parseLong(scopeVersion));
        return Map.of("revision", request.revision(), "accepted", true);
    }

    public Map<String, Object> deviceFeed(String device) {
        devices.current(device);
        var feed = mapper.readFeed(device);
        return Map.of("revision", feed == null ? "0" : feed.get("revision").toString());
    }

    public Map<String, Object> page(String device, String after, int limit) {
        var known = devices.list().stream().filter(item -> item.id().equals(device)).findFirst()
                .orElseThrow(() -> new ApiException(404, "NOT_FOUND", "设备不存在。"));
        if (limit < 1 || limit > 100) throw new ApiException(400, "INVALID_REQUEST", "分页大小须为 1–100。");
        if (!after.isEmpty()) NotePaths.validate(after);
        var rows = mapper.page(device, after, limit + 1);
        var attachments = known.scope().all() ? List.<String>of() : notes.syncAttachmentPaths(known.scope().folders());
        var feed = mapper.readFeed(device);
        var result = new LinkedHashMap<String, Object>();
        result.put("reported", feed != null); result.put("revoked", known.revoked());
        result.put("reportedAt", feed == null ? null : feed.get("reportedAt").toString());
        result.put("scopeVersion", known.scopeVersion());
        result.put("items", rows.stream().limit(limit).map(row -> {
            var item = new LinkedHashMap<String, Object>(json.readValue(row.metadataJson(), Map.class));
            item.put("scopeVersion", Long.toString(row.scopeVersion()));
            item.put("reportedAt", row.reportedAt().atOffset(java.time.ZoneOffset.UTC).toString());
            item.put("inScope", known.scope().all() || known.scope().folders().stream().anyMatch(root -> row.path().startsWith(root + "/")) || attachments.contains(row.path()));
            return item;
        }).toList());
        result.put("nextCursor", rows.size() > limit ? rows.get(limit - 1).path() : null);
        return result;
    }
}
