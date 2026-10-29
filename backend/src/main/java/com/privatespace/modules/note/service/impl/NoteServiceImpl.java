package com.privatespace.modules.note.service.impl;

import java.nio.charset.StandardCharsets;
import java.nio.charset.CharacterCodingException;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.file.service.FileObjectService;
import com.privatespace.modules.note.dto.NoteResponse;
import com.privatespace.modules.note.dto.WriteNoteRequest;
import com.privatespace.modules.note.dto.SyncWriteRequest;
import com.privatespace.modules.note.entity.NoteFileEntity;
import com.privatespace.modules.note.mapper.NoteMapper;
import com.privatespace.modules.note.service.NoteService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class NoteServiceImpl implements NoteService {
    private final NoteMapper mapper;
    private final FileObjectService objects;
    private final ObjectMapper json;

    public NoteServiceImpl(NoteMapper mapper, FileObjectService objects, ObjectMapper json) {
        this.mapper = mapper;
        this.objects = objects;
        this.json = json;
    }

    public Map<String, Object> list(boolean deleted, String cursor, String query) {
        return list(deleted, cursor, query, false);
    }

    public Map<String, Object> list(boolean deleted, String cursor, String query, boolean includeGroups) {
        String after = cursor == null || cursor.isEmpty() ? "" : UUID.fromString(cursor).toString();
        var rows = mapper.list(deleted, after, query == null ? "" : query, deleted && includeGroups);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", rows.stream().limit(200).map(row -> response(row, null)).toList());
        result.put("nextCursor", rows.size() > 200 ? rows.get(199).id() : null);
        return result;
    }

    public NoteResponse read(String id, boolean track) {
        var note = required(id);
        if (track && !note.deleted()) mapper.opened(note.id());
        return response(note, "note".equals(note.type()) ? text(objects.read(note.objectId())) : null);
    }

    @Transactional
    public NoteResponse create(WriteNoteRequest request, String operation) {
        mapper.lock();
        var previous = previous(operation, "create", request);
        if (previous != null) return previous;
        String path = validatePath(request.path());
        if (!List.of("note", "folder").contains(request.type())) throw new ApiException(400, "UNSUPPORTED_FORMAT", "请选择笔记或文件夹。");
        if ("note".equals(request.type()) && !path.toLowerCase(Locale.ROOT).endsWith(".md")) throw new ApiException(400, "INVALID_PATH", "笔记文件名应以 .md 结尾。");
        parent(path);
        if (mapper.byPath(path) != null) throw new ApiException(409, "PATH_CONFLICT", "同名文件已存在或位于回收站，请更换名称。");
        byte[] bytes = content("note".equals(request.type()) ? request.content() : "");
        var object = "note".equals(request.type()) ? objects.write(bytes) : null;
        String id = UUID.randomUUID().toString();
        mapper.create(new NoteFileEntity(id, path, request.type(), 1, object == null ? null : object.id(),
                object == null ? null : request.content(), false, false, null, null,
                object == null ? 0 : object.size(), object == null ? null : object.sha256()));
        publish(id);
        return remember(operation, "create", request, read(id, false));
    }

    @Transactional
    public NoteResponse save(String id, WriteNoteRequest request, String operation) {
        mapper.lock();
        var previous = previous(operation, "save:" + id, request);
        if (previous != null) return previous;
        var current = required(id);
        expected(current, request.baseVersion());
        if (current.deleted() || !"note".equals(current.type())) throw new ApiException(409, "VERSION_CONFLICT", "对象已删除或不是普通笔记。");
        if (!current.path().equals(request.path())) throw new ApiException(400, "INVALID_REQUEST", "请使用独立的移动流程修改路径。");
        byte[] bytes = content(request.content());
        if (!digest(bytes).equals(current.sha256())) {
            var object = objects.write(bytes);
            mapper.update(id, current.version() + 1, object.id(), request.content(), object.size(), object.sha256(), false);
            publish(id);
        }
        return remember(operation, "save:" + id, request, read(id, false));
    }

    @Transactional
    public NoteResponse delete(String id, String baseVersion, String operation) {
        return delete(id, baseVersion, operation, null);
    }

    @Transactional
    public com.privatespace.modules.note.dto.DeletePreviewResponse deletePreview(String id, String baseVersion) {
        mapper.lock();
        var current = required(id);
        expected(current, baseVersion);
        if (current.deleted()) throw new ApiException(409, "VERSION_CONFLICT", "内容已删除，请刷新目录。");
        return deletionPlan(current);
    }

    private com.privatespace.modules.note.dto.DeletePreviewResponse deletionPlan(NoteFileEntity current) {
        var affected = current.type().equals("folder") ? mapper.subtree(current.path()) : List.of(current);
        var targets = affected.stream().map(file -> new com.privatespace.modules.note.dto.DeletePreviewResponse.Target(
                file.id(), file.path(), file.type(), Long.toString(file.version()))).toList();
        return new com.privatespace.modules.note.dto.DeletePreviewResponse(digest(json.writeValueAsBytes(targets)), targets);
    }

    @Transactional
    public NoteResponse delete(String id, String baseVersion, String operation, String fingerprint) {
        mapper.lock();
        Object input = fingerprint == null ? baseVersion : List.of(baseVersion, fingerprint);
        var previous = previous(operation, "delete:" + id, input);
        if (previous != null) return previous;
        var current = required(id);
        expected(current, baseVersion);
        if (current.deleted()) throw new ApiException(409, "VERSION_CONFLICT", "内容已删除，请刷新目录。");
        var plan = deletionPlan(current);
        if (fingerprint != null && !fingerprint.equals(plan.fingerprint())) throw new ApiException(409, "PREVIEW_EXPIRED", "目录内容已变化，请重新确认删除范围。");
        for (var target : plan.targets()) {
            var file = required(target.id());
            if (current.type().equals("folder")) mapper.deleteMember(new com.privatespace.modules.note.entity.DeleteMemberEntity(
                    current.id(), current.version() + 1, file.id(), file.version(), file.version() + 1, file.path()));
            mapper.update(file.id(), file.version() + 1, file.objectId(), file.content(), file.size(), file.sha256(), true);
            publish(file.id());
        }
        return remember(operation, "delete:" + id, input, read(id, false));
    }

    @Transactional
    public NoteResponse restore(String id, String version, String baseVersion, String operation) {
        mapper.lock();
        var input = List.of(version, baseVersion);
        var previous = previous(operation, "restore:" + id, input);
        if (previous != null) return previous;
        var current = required(id);
        expected(current, baseVersion);
        if (current.type().equals("folder") && current.deleted()) {
            var members = mapper.deleteMembers(current.id(), current.version());
            if (!members.isEmpty()) {
                var root = members.stream().filter(member -> member.fileId().equals(current.id())).findFirst().orElseThrow();
                if (!Long.toString(root.beforeVersion()).equals(version)) throw new ApiException(409, "DIRECTORY_SNAPSHOT_REQUIRED", "请选择目录删除前的版本，恢复删除时的完整目录。");
                parent(current.path());
                for (var member : members) {
                    var file = required(member.fileId());
                    if (!file.deleted() || file.version() != member.deletedVersion() || !file.path().equals(member.path())) {
                        throw new ApiException(409, "VERSION_CONFLICT", "目录中的内容已变化，未覆盖任何文件，请先核对回收站。");
                    }
                    var occupied = mapper.byPath(member.path());
                    if (occupied != null && !occupied.id().equals(file.id())) throw new ApiException(409, "PATH_CONFLICT", "原路径存在重名内容，目录未恢复。");
                }
                // Read and verify each immutable historical object; any failure rolls back the whole tree.
                for (var member : members) {
                    var file = required(member.fileId());
                    var historic = mapper.revision(file.id(), member.beforeVersion());
                    if (historic == null || historic.deleted()) throw new ApiException(409, "HISTORY_UNAVAILABLE", "目录快照不完整，未恢复任何内容。");
                    byte[] bytes = historic.objectId() == null ? new byte[0] : objects.read(historic.objectId());
                    mapper.update(file.id(), file.version() + 1, historic.objectId(), file.type().equals("note") ? text(bytes) : null,
                            bytes.length, historic.objectId() == null ? null : digest(bytes), false);
                    publish(file.id());
                }
                return remember(operation, "restore:" + id, input, read(id, false));
            }
        }
        var historic = mapper.revision(id, Long.parseLong(version));
        if (historic == null || historic.deleted()) throw new ApiException(404, "NOT_FOUND", "可恢复版本不存在。");
        parent(current.path());
        byte[] bytes = historic.objectId() == null ? new byte[0] : objects.read(historic.objectId());
        mapper.update(id, current.version() + 1, historic.objectId(), "note".equals(current.type()) ? text(bytes) : null,
                bytes.length, historic.objectId() == null ? null : digest(bytes), false);
        publish(id);
        return remember(operation, "restore:" + id, input, read(id, false));
    }

    public List<Map<String, Object>> history(String id) {
        required(id);
        return mapper.historyList(id).stream().map(revision -> Map.<String, Object>of(
                "version", Long.toString(revision.version()), "deleted", revision.deleted(), "createdAt", time(revision.createdAt()))).toList();
    }

    public NoteResponse revision(String id, String version) {
        var current = required(id);
        var revision = mapper.revision(id, Long.parseLong(version));
        if (revision == null) throw new ApiException(404, "NOT_FOUND", "版本不存在。");
        byte[] bytes = revision.objectId() == null ? new byte[0] : objects.read(revision.objectId());
        return new NoteResponse(id, revision.path(), current.type(), version,
                "note".equals(current.type()) ? text(bytes) : null,
                revision.deleted(), current.favorite(), time(current.lastOpenedAt()), time(revision.createdAt()), bytes.length,
                revision.objectId() == null ? null : digest(bytes));
    }

    public void favorite(String id, boolean favorite) { mapper.favorite(required(id).id(), favorite); }

    @Transactional
    public NoteResponse upload(String path, byte[] bytes, String operation) {
        mapper.lock();
        String safe = validatePath(path);
        var input = List.of(safe, digest(bytes));
        var previous = previous(operation, "upload", input);
        if (previous != null) return previous;
        if (bytes.length > 50 * 1024 * 1024) throw new ApiException(413, "FILE_TOO_LARGE", "附件最大 50 MiB。");
        parent(safe);
        if (mapper.byPath(safe) != null) throw new ApiException(409, "PATH_CONFLICT", "同名附件已存在，请更换名称。");
        var object = objects.write(bytes);
        String id = UUID.randomUUID().toString();
        mapper.create(new NoteFileEntity(id, safe, "attachment", 1, object.id(), null, false, false, null, null, object.size(), object.sha256()));
        publish(id);
        return remember(operation, "upload", input, read(id, false));
    }

    public byte[] download(String path) {
        var current = mapper.byPath(validatePath(path));
        if (current == null || current.deleted() || "folder".equals(current.type())) throw new ApiException(404, "NOT_FOUND", "文件不存在或已删除。");
        return objects.read(current.objectId());
    }

    @Transactional
    public Map<String, Object> syncSnapshot() {
        mapper.lock();
        var files = mapper.moveCatalog();
        if (files.size() > 5000) throw new ApiException(413, "PROTOTYPE_LIMIT", "M0 对账原型最多验证 5000 个对象，请勿用于完整生产同步。");
        return Map.of("cursor", Long.toString(mapper.syncCursor()), "items", files.stream().map(file -> response(file, null)).toList());
    }

    public byte[] syncRead(String id, String version) {
        var current = required(id);
        expected(current, version);
        if (current.deleted() || "folder".equals(current.type())) throw new ApiException(404, "NOT_FOUND", "文件不存在或已删除。");
        return objects.read(current.objectId());
    }

    @Transactional
    public NoteResponse syncWrite(SyncWriteRequest request, String operation, String device) {
        mapper.lock();
        String scope = "sync:" + UUID.fromString(device);
        var previous = previous(operation, scope, request);
        if (previous != null) return previous;
        String path = validatePath(request.path());
        var current = request.id() == null ? null : required(request.id());
        if (current == null && (!"0".equals(request.baseVersion()) || request.deleted())) throw new ApiException(400, "INVALID_REQUEST", "新增文件不能携带旧版本或删除标记。");
        if (current != null) {
            expected(current, request.baseVersion());
            if (current.deleted() || !current.path().equals(path) || "folder".equals(current.type())) throw new ApiException(409, "VERSION_CONFLICT", "文件路径或状态已变化，请重新对账。");
        } else if (mapper.byPath(path) != null) throw new ApiException(409, "PATH_CONFLICT", "路径已存在或位于回收站，未覆盖内容。");
        if (request.deleted()) {
            mapper.update(current.id(), current.version() + 1, current.objectId(), current.content(), current.size(), current.sha256(), true);
            publish(current.id());
            return remember(operation, scope, request, read(current.id(), false));
        }
        if (request.contentBase64() == null || request.contentBase64().length() > 70 * 1024 * 1024) throw new ApiException(413, "FILE_TOO_LARGE", "同步文件超出限额。");
        byte[] bytes = java.util.Base64.getDecoder().decode(request.contentBase64());
        if (!digest(bytes).equals(request.sha256())) throw new ApiException(400, "CHECKSUM_MISMATCH", "同步内容摘要校验失败，未发布版本。");
        String type = current == null ? (path.toLowerCase(Locale.ROOT).endsWith(".md") ? "note" : "attachment") : current.type();
        if (bytes.length > ("note".equals(type) ? 1024 * 1024 : 50 * 1024 * 1024)) throw new ApiException(413, "FILE_TOO_LARGE", "同步文件超出限额。");
        String body = "note".equals(type) ? text(bytes) : null;
        if (current != null && current.sha256().equals(request.sha256())) return remember(operation, scope, request, read(current.id(), false));
        // Parent creation and the file publication share the same notebook transaction.
        int separator = path.indexOf('/');
        while (separator >= 0) {
            String parent = path.substring(0, separator);
            var folder = mapper.byPath(parent);
            if (folder == null) {
                String id = UUID.randomUUID().toString();
                mapper.create(new NoteFileEntity(id, parent, "folder", 1, null, null, false, false, null, null, 0, null));
                publish(id);
            } else if (folder.deleted() || !"folder".equals(folder.type()) || !folder.path().equals(parent)) {
                throw new ApiException(409, "PATH_CONFLICT", "父目录存在冲突，请先处理目录。");
            }
            separator = path.indexOf('/', separator + 1);
        }
        var object = objects.write(bytes);
        String id = current == null ? UUID.randomUUID().toString() : current.id();
        if (current == null) mapper.create(new NoteFileEntity(id, path, type, 1, object.id(), body, false, false, null, null, object.size(), object.sha256()));
        else mapper.update(id, current.version() + 1, object.id(), body, object.size(), object.sha256(), false);
        publish(id);
        return remember(operation, scope, request, read(id, false));
    }

    private void parent(String path) {
        if (!path.contains("/")) return;
        var parent = mapper.byPath(path.substring(0, path.lastIndexOf('/')));
        if (parent == null || parent.deleted() || !"folder".equals(parent.type())) throw new ApiException(400, "INVALID_PATH", "父文件夹不存在，请先创建文件夹。");
    }

    private void publish(String id) { mapper.history(id); mapper.change(id); }

    private NoteFileEntity required(String id) {
        var result = mapper.find(UUID.fromString(id).toString());
        if (result == null) throw new ApiException(404, "NOT_FOUND", "笔记不存在。");
        return result;
    }

    private void expected(NoteFileEntity current, String version) {
        if (!Long.toString(current.version()).equals(version)) throw new ApiException(409, "VERSION_CONFLICT", "服务器已有新版本，未覆盖任何内容。请保留草稿并对比后处理。");
    }

    private NoteResponse response(NoteFileEntity row, String content) {
        return new NoteResponse(row.id(), row.path(), row.type(), Long.toString(row.version()), content,
                row.deleted(), row.favorite(), time(row.lastOpenedAt()), time(row.updatedAt()), row.size(), row.sha256());
    }

    private String time(LocalDateTime value) { return value == null ? null : value.atOffset(ZoneOffset.UTC).toString(); }

    private byte[] content(String content) {
        if (content == null) throw new ApiException(400, "INVALID_REQUEST", "笔记正文不能为空值。");
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 1024 * 1024) throw new ApiException(413, "FILE_TOO_LARGE", "笔记最大 1 MiB。");
        return bytes;
    }

    private String text(byte[] bytes) {
        try { return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString(); }
        catch (CharacterCodingException exception) { throw new ApiException(400, "UNSUPPORTED_FORMAT", "仅支持有效的 UTF-8 Markdown 文件。"); }
    }

    private String validatePath(String path) {
        return com.privatespace.modules.note.service.NotePaths.validate(path);
    }

    private NoteResponse previous(String operation, String scope, Object input) {
        UUID.fromString(operation);
        String response = mapper.previous(operation, scope, digest(json.writeValueAsBytes(input)));
        if (response != null) return json.readValue(response, NoteResponse.class);
        if (mapper.operationExists(operation, scope) > 0) throw new ApiException(409, "IDEMPOTENCY_CONFLICT", "同一操作标识对应了不同内容，请重新发起操作。");
        return null;
    }

    private NoteResponse remember(String operation, String scope, Object input, NoteResponse response) {
        mapper.operation(operation, scope, digest(json.writeValueAsBytes(input)), json.writeValueAsString(response));
        return response;
    }

    private String digest(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (java.security.NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }
}
