package com.privatespace.modules.mindmap.service.impl;

import java.security.MessageDigest;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.mindmap.dto.MindmapDtos.*;
import com.privatespace.modules.mindmap.entity.MindmapEntity;
import com.privatespace.modules.mindmap.mapper.MindmapMapper;
import com.privatespace.modules.mindmap.service.MindmapService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Version-checked, idempotent diagram writes. Untrusted HTML/URLs never reach the renderer. */
@Service
public class MindmapServiceImpl implements MindmapService {
    private final MindmapMapper mapper;
    private final ObjectMapper json;
    public MindmapServiceImpl(MindmapMapper mapper, ObjectMapper json) { this.mapper = mapper; this.json = json; }

    private ApiException invalid() { return new ApiException(400, "INVALID_MINDMAP", "请使用有效的导图 JSON：最多 1000 个纯文本节点、40 层，每节点 1000 字，总计 1 MiB。"); }
    private void id(String id) { try { if (!UUID.fromString(id).toString().equals(id)) throw invalid(); } catch (RuntimeException exception) { throw invalid(); } }
    private MindmapEntity required(String id) {
        id(id);
        var row = mapper.find(id);
        if (row == null) throw new ApiException(404, "MINDMAP_NOT_FOUND", "导图不存在。");
        return row;
    }
    private String time(MindmapEntity row) { return row.updatedAt().atOffset(java.time.ZoneOffset.UTC).toString(); }
    private Snapshot snapshot(MindmapEntity row) { return new Snapshot(row.id(), row.title(), Long.toString(row.version()), row.document() == null ? null : json.readTree(row.document()), row.deleted(), time(row)); }
    @Transactional(readOnly = true)
    public Page list(boolean deleted, String query, int page) {
        if (page < 1 || page > 1000000 || query == null || query.length() > 200) throw invalid();
        return new Page(mapper.list(deleted, query, (page - 1) * 10).stream().map(this::snapshot).toList(), mapper.total(deleted, query), page);
    }
    public Snapshot read(String id) { return snapshot(required(id)); }
    private void fields(JsonNode node, Set<String> allowed) {
        if (!node.isObject()) throw invalid();
        for (String key : node.propertyNames()) if (!allowed.contains(key)) throw invalid();
    }
    private void node(JsonNode node, int depth, Set<String> ids) {
        if (depth > 40) throw invalid();
        fields(node, Set.of("id", "topic", "children", "expanded", "direction"));
        var id = node.get("id"); var topic = node.get("topic"); var children = node.get("children");
        if (id == null || !id.isString() || !id.asString().matches("[A-Za-z0-9_-]{1,64}") || !ids.add(id.asString()) || ids.size() > 1000
                || topic == null || !topic.isString() || topic.asString().isBlank() || topic.asString().length() > 1000
                || children == null || !children.isArray()) throw invalid();
        if (node.has("expanded") && !node.get("expanded").isBoolean()) throw invalid();
        if (node.has("direction") && (!node.get("direction").isIntegralNumber() || node.get("direction").asInt() < 0 || node.get("direction").asInt() > 1)) throw invalid();
        for (var child : children) node(child, depth + 1, ids);
    }
    private String document(JsonNode document) {
        if (document == null || json.writeValueAsBytes(document).length > 1024 * 1024) throw invalid();
        fields(document, Set.of("format", "schemaVersion", "direction", "nodeData"));
        if (!document.path("format").isString() || !document.path("format").asString().equals("workbench-mindmap") || !document.path("schemaVersion").isIntegralNumber() || document.path("schemaVersion").asInt() != 1
                || !document.path("direction").isIntegralNumber() || document.path("direction").asInt() < 0 || document.path("direction").asInt() > 3 || !document.has("nodeData")) throw invalid();
        node(document.get("nodeData"), 1, new HashSet<>());
        return json.writeValueAsString(document);
    }
    private Saved begin(String operation, String hash) {
        id(operation); mapper.lock();
        var previous = mapper.operationHash(operation);
        if (previous == null) return null;
        if (!previous.equals(hash)) throw new ApiException(409, "MINDMAP_OPERATION_REUSED", "该操作已用于其他内容。");
        return json.readValue(mapper.operationResult(operation), Saved.class);
    }
    private String hash(Object input) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(json.writeValueAsBytes(input))); }
        catch (java.security.NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }
    private void version(MindmapEntity row, String base) {
        if (base == null || !Long.toString(row.version()).equals(base)) throw new ApiException(409, "MINDMAP_CHANGED", "导图版本已变化，本机草稿保留，请核对服务器版本。");
    }
    private Saved finish(String id, String operation, String hash) {
        var row = required(id);
        var saved = new Saved(id, Long.toString(row.version()), row.deleted(), time(row));
        mapper.receipt(operation, hash, json.writeValueAsString(saved));
        return saved;
    }
    @Transactional
    public Saved save(String id, Write request, String operation) {
        id(id);
        if (request == null || request.title() == null || request.title().isBlank() || request.title().length() > 120 || request.baseVersion() == null) throw invalid();
        String content = document(request.document());
        String hash = hash(List.of("save", id, request.baseVersion(), request.title(), content));
        var previous = begin(operation, hash); if (previous != null) return previous;
        var row = mapper.find(id);
        if (row == null) {
            if (!request.baseVersion().equals("0")) throw new ApiException(404, "MINDMAP_NOT_FOUND", "导图不存在，本机草稿保留。");
            mapper.create(id, request.title().trim(), content);
        } else {
            version(row, request.baseVersion());
            if (row.deleted()) throw new ApiException(409, "MINDMAP_DELETED", "导图已在回收站，恢复后再编辑，本机草稿保留。");
            mapper.save(id, request.title().trim(), content);
        }
        return finish(id, operation, hash);
    }
    @Transactional
    public Saved deleted(String id, Version request, boolean deleted, String operation) {
        id(id);
        if (request == null || request.baseVersion() == null) throw invalid();
        String hash = hash(List.of("deleted", id, deleted, request.baseVersion()));
        var previous = begin(operation, hash); if (previous != null) return previous;
        var row = required(id); version(row, request.baseVersion());
        if (row.deleted() != deleted) mapper.deleted(id, deleted);
        return finish(id, operation, hash);
    }
}
