package com.privatespace.modules.note.service.impl;

import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.file.service.FileObjectService;
import com.privatespace.modules.note.dto.NoteResponse;
import com.privatespace.modules.note.dto.SyncChangePage;
import com.privatespace.modules.note.mapper.NoteMapper;
import com.privatespace.modules.note.service.MarkdownAttachments;
import com.privatespace.modules.note.service.NoteChangeService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class NoteChangeServiceImpl implements NoteChangeService {
    private final NoteMapper mapper;
    private final FileObjectService objects;
    private final ObjectMapper json;

    public NoteChangeServiceImpl(NoteMapper mapper, FileObjectService objects, ObjectMapper json) {
        this.mapper = mapper; this.objects = objects; this.json = json;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void publish(String id) {
        var file = mapper.find(id);
        var previous = mapper.revision(id, file.version() - 1);
        Set<String> before = Set.of();
        boolean uncertain = false;
        if (previous != null && !previous.deleted() && previous.objectId() != null && previous.path().toLowerCase(java.util.Locale.ROOT).endsWith(".md")) {
            try {
                String content = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                        .decode(ByteBuffer.wrap(objects.read(previous.objectId()))).toString();
                before = MarkdownAttachments.paths(previous.path(), content);
            } catch (java.nio.charset.CharacterCodingException exception) { uncertain = true; }
        }
        Set<String> after = !file.deleted() && file.type().equals("note") ? MarkdownAttachments.paths(file.path(), file.content()) : Set.of();
        var metadata = metadata(file);
        mapper.change(id, json.writeValueAsString(metadata), previous == null ? null : previous.path(), uncertain || !before.equals(after));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void purge(com.privatespace.modules.note.entity.NoteFileEntity file) {
        mapper.purgeChange(file, json.writeValueAsString(metadata(file)));
    }

    public List<NoteResponse> retainedTombstones() {
        var rows = mapper.retainedPurges();
        return rows.stream().map(row -> json.readValue(row.metadataJson(), NoteResponse.class)).toList();
    }

    @Transactional
    public SyncChangePage changes(String cursor, String end, int limit, List<String> folders, List<String> attachments) {
        mapper.lock();
        if (limit < 1 || limit > 500) throw new ApiException(400, "INVALID_SYNC_CURSOR", "分页大小须为 1–500。");
        long after = number(cursor), head = mapper.syncCursor(), until = end == null ? head : number(end);
        if (after < mapper.syncFloor()) throw new ApiException(410, "SYNC_CURSOR_EXPIRED", "同步记录已过期，已停止增量同步；请保留文件和队列并重新对账。");
        if (after > head || until > head) throw new ApiException(409, "SERVER_ROLLBACK_RECONCILIATION_REQUIRED", "服务器游标回退，需重新核对，未覆盖文件。");
        if (until < after) throw new ApiException(400, "INVALID_SYNC_CURSOR", "结束游标不能早于起始游标。");
        var rows = mapper.syncChanges(after, until, limit + 1);
        var changes = new ArrayList<SyncChangePage.Item>();
        for (var row : rows.stream().limit(limit).toList()) {
            if (row.metadataJson() == null) throw new ApiException(409, "SYNC_VIEW_CHANGED", "旧事件缺少完整元数据，请重新获取目录。");
            var file = json.readValue(row.metadataJson(), NoteResponse.class);
            boolean explicit = inside(file.path(), folders), beforeExplicit = inside(row.beforePath(), folders);
            if (!folders.isEmpty() && row.referencesChanged() && (explicit || beforeExplicit)) {
                throw new ApiException(409, "SYNC_VIEW_CHANGED", "引用附件范围已变化，请重新获取目录。");
            }
            boolean shared = file.type().equals("attachment") && attachments.contains(file.path());
            boolean beforeShared = row.beforePath() != null && attachments.contains(row.beforePath());
            if (!folders.isEmpty() && beforeShared && (!shared || !file.path().equals(row.beforePath()))) {
                throw new ApiException(409, "SYNC_VIEW_CHANGED", "共享附件路径已变化，请重新获取目录。");
            }
            if ((explicit || shared) && row.purged()) changes.add(new SyncChangePage.Item(file.id(), file, true));
            else if (explicit || shared) changes.add(new SyncChangePage.Item(file.id(), file, false));
            else if (beforeExplicit || beforeShared) changes.add(new SyncChangePage.Item(file.id(), null, true));
        }
        boolean complete = rows.size() <= limit;
        long next = complete ? until : rows.get(limit - 1).sequenceId();
        return new SyncChangePage(Long.toString(next), Long.toString(until), complete, changes);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void prune(LocalDateTime cutoff, int limit) {
        var prefix = mapper.expiredChangePrefix(cutoff, limit);
        if (!prefix.isEmpty()) {
            long floor = prefix.get(prefix.size() - 1);
            mapper.advanceSyncFloor(floor);
            mapper.pruneSyncChanges(floor);
        }
    }

    private boolean inside(String path, List<String> folders) {
        return path != null && (folders.isEmpty() || folders.stream().anyMatch(root -> path.equals(root) || path.startsWith(root + "/")));
    }

    private long number(String value) {
        try {
            if (value == null || !value.matches("0|[1-9][0-9]{0,18}")) throw new NumberFormatException();
            return Long.parseLong(value);
        } catch (NumberFormatException exception) { throw new ApiException(400, "INVALID_SYNC_CURSOR", "同步游标无效。"); }
    }

    private String time(LocalDateTime value) { return value == null ? null : value.atOffset(ZoneOffset.UTC).toString(); }

    private NoteResponse metadata(com.privatespace.modules.note.entity.NoteFileEntity file) {
        return new NoteResponse(file.id(), file.path(), file.type(), Long.toString(file.version()), null,
                file.deleted(), file.favorite(), time(file.lastOpenedAt()), time(file.updatedAt()), file.size(), file.sha256());
    }
}
