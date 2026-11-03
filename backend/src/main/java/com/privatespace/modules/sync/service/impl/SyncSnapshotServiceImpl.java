package com.privatespace.modules.sync.service.impl;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.note.dto.NoteResponse;
import com.privatespace.modules.note.service.NoteService;
import com.privatespace.modules.sync.dto.SyncDeviceResponse;
import com.privatespace.modules.sync.entity.SyncSnapshotItemEntity;
import com.privatespace.modules.sync.mapper.SyncSnapshotMapper;
import com.privatespace.modules.sync.service.SyncSnapshotService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

@Service
public class SyncSnapshotServiceImpl implements SyncSnapshotService {
    private final SyncSnapshotMapper mapper;
    private final NoteService notes;
    private final ObjectMapper json;

    public SyncSnapshotServiceImpl(SyncSnapshotMapper mapper, NoteService notes, ObjectMapper json) {
        this.mapper = mapper; this.notes = notes; this.json = json;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public Map<String, Object> page(SyncDeviceResponse device, String snapshot, String after, int limit) {
        long position = position(after);
        if (limit < 1 || limit > 500 || snapshot == null && position != 0) invalid();
        if (snapshot == null) snapshot = create(device);
        if (!snapshot.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}")) invalid();
        var header = mapper.find(snapshot, device.id());
        if (header == null) throw new ApiException(410, "SYNC_SNAPSHOT_EXPIRED", "目录分页已失效，请重试；原文件和同步队列已保留。");
        if (header.scopeVersion() != Long.parseLong(device.scopeVersion())) {
            throw new ApiException(409, "SYNC_SCOPE_CHANGED", "同步范围已变化，请重新读取完整目录。");
        }
        if (position > header.itemCount()) invalid();
        var items = mapper.page(snapshot, position, limit).stream().map(item -> json.readValue(item, NoteResponse.class)).toList();
        var result = new LinkedHashMap<String, Object>(json.readValue(header.metadataJson(), new TypeReference<Map<String, Object>>() {}));
        result.put("snapshot", snapshot);
        result.put("after", Long.toString(position + items.size()));
        result.put("total", Long.toString(header.itemCount()));
        result.put("complete", position + items.size() == header.itemCount());
        result.put("items", items);
        return result;
    }

    private String create(SyncDeviceResponse device) {
        var view = new LinkedHashMap<>(notes.syncCatalog(device.scope().all() ? List.of() : device.scope().folders()));
        var items = (List<?>) view.remove("items");
        view.put("scope", device.scope());
        view.put("scopeVersion", device.scopeVersion());
        view.put("fileRenameSupported", true);
        view.put("incrementalSupported", true);
        view.put("snapshotPagingSupported", true);
        String id = UUID.randomUUID().toString();
        mapper.discard(device.id());
        mapper.create(id, device.id(), Long.parseLong(device.scopeVersion()), json.writeValueAsString(view), items.size());
        // Bound each INSERT, while the surrounding notebook transaction freezes the whole view.
        for (int start = 0; start < items.size(); start += 200) {
            var batch = new ArrayList<SyncSnapshotItemEntity>();
            for (int index = start; index < Math.min(start + 200, items.size()); index++) {
                batch.add(new SyncSnapshotItemEntity(index + 1L, json.writeValueAsString(items.get(index))));
            }
            mapper.append(id, batch);
        }
        return id;
    }

    private long position(String value) {
        if (value == null) return 0;
        try {
            if (!value.matches("0|[1-9][0-9]{0,18}")) throw new NumberFormatException();
            return Long.parseLong(value);
        } catch (NumberFormatException exception) { invalid(); return 0; }
    }

    private void invalid() { throw new ApiException(400, "INVALID_SYNC_CURSOR", "目录分页参数无效，分页大小须为 1–500。"); }
}
