package com.privatespace.modules.note.service.impl;

import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.file.service.FileObjectService;
import com.privatespace.modules.note.dto.MoveNoteRequest;
import com.privatespace.modules.note.dto.MovePreviewResponse;
import com.privatespace.modules.note.dto.NoteResponse;
import com.privatespace.modules.note.entity.NoteFileEntity;
import com.privatespace.modules.note.mapper.NoteMapper;
import com.privatespace.modules.note.service.NoteMoveService;
import com.privatespace.modules.note.service.NotePaths;
import com.privatespace.modules.note.service.NoteService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class NoteMoveServiceImpl implements NoteMoveService {
    private final NoteMapper mapper;
    private final FileObjectService objects;
    private final NoteService notes;
    private final ObjectMapper json;
    private final MarkdownLinkRewriter links = new MarkdownLinkRewriter();

    public NoteMoveServiceImpl(NoteMapper mapper, FileObjectService objects, NoteService notes, ObjectMapper json) {
        this.mapper = mapper;
        this.objects = objects;
        this.notes = notes;
        this.json = json;
    }

    private record FileChange(NoteFileEntity before, String path, String content) { }
    private record Plan(MovePreviewResponse preview, List<FileChange> files) { }

    @Override
    @Transactional
    public MovePreviewResponse preview(String id, MoveNoteRequest request) {
        mapper.lock();
        return plan(id, request).preview();
    }

    @Override
    @Transactional
    public NoteResponse move(String id, MoveNoteRequest request, String operation) {
        UUID.fromString(operation);
        mapper.lock();
        String scope = "move:" + UUID.fromString(id);
        String requestHash = digest(json.writeValueAsBytes(request));
        String previous = mapper.previous(operation, scope, requestHash);
        if (previous != null) return json.readValue(previous, NoteResponse.class);
        if (mapper.operationExists(operation, scope) > 0) throw new ApiException(409, "IDEMPOTENCY_CONFLICT", "操作标识已用于不同的移动请求。");
        var plan = plan(id, request);
        if (!plan.preview().fingerprint().equals(request.fingerprint())) {
            throw new ApiException(409, "PREVIEW_STALE", "目录或笔记已发生变化。未移动任何文件，请重新预览后确认。");
        }
        for (var change : plan.files()) {
            var file = change.before();
            String objectId = file.objectId();
            long size = file.size();
            String sha = file.sha256();
            if (change.content() != null && !change.content().equals(text(file.objectId()))) {
                byte[] bytes = change.content().getBytes(StandardCharsets.UTF_8);
                if (bytes.length > 1024 * 1024) throw new ApiException(413, "FILE_TOO_LARGE", "链接修复后笔记超过 1 MiB，未提交移动。");
                var object = objects.write(bytes);
                objectId = object.id(); size = object.size(); sha = object.sha256();
            }
            mapper.repath(file.id(), change.path());
            mapper.update(file.id(), file.version() + 1, objectId, change.content(), size, sha, false);
            mapper.history(file.id());
            mapper.change(file.id());
        }
        NoteResponse response = notes.read(id, false);
        mapper.operation(operation, scope, requestHash, json.writeValueAsString(response));
        return response;
    }

    private Plan plan(String id, MoveNoteRequest request) {
        var source = mapper.find(UUID.fromString(id).toString());
        if (source == null || source.deleted()) throw new ApiException(404, "NOT_FOUND", "要移动的文件不存在或已删除。");
        if (!Long.toString(source.version()).equals(request.baseVersion())) throw new ApiException(409, "VERSION_CONFLICT", "文件已有新版本，请刷新目录后重试。");
        String target = NotePaths.validate(request.targetPath());
        if (target.contains("/")) {
            var parent = mapper.byPath(target.substring(0, target.lastIndexOf('/')));
            if (parent == null || parent.deleted() || !parent.type().equals("folder")) throw new ApiException(400, "INVALID_PATH", "目标文件夹不存在。");
            target = parent.path() + target.substring(target.lastIndexOf('/'));
        }
        if (target.equals(source.path())) throw new ApiException(400, "NO_CHANGE", "名称和目录没有变化。");
        if (source.type().equals("note") && !target.endsWith(".md")) throw new ApiException(400, "INVALID_PATH", "笔记文件名必须以 .md 结尾。");
        if (source.type().equals("folder") && nested(target, source.path())) throw new ApiException(400, "INVALID_PATH", "不能把文件夹移动到自身或子文件夹中。");
        var catalog = mapper.moveCatalog();
        Map<String, NoteFileEntity> byPath = new HashMap<>();
        Map<String, String> paths = new HashMap<>();
        for (var file : catalog) {
            byPath.put(file.path().toLowerCase(Locale.ROOT), file);
            if (!file.deleted() && (file.id().equals(source.id()) || source.type().equals("folder") && nested(file.path(), source.path()))) {
                String path = target + file.path().substring(source.path().length());
                NotePaths.validate(path);
                var occupied = mapper.byPath(path);
                if (occupied != null && !occupied.id().equals(file.id())) throw new ApiException(409, "PATH_CONFLICT", "目标路径已存在或位于回收站，未覆盖任何文件：" + path);
                paths.put(file.id(), path);
            }
        }
        var changes = new ArrayList<MovePreviewResponse.Change>();
        var files = new ArrayList<FileChange>();
        var warnings = new ArrayList<String>();
        for (var file : catalog) {
            if (file.deleted()) {
                if (source.type().equals("folder") && nested(file.path(), source.path())) warnings.add(file.path() + "：回收站内容保留原路径，恢复前需确保原目录存在。");
                continue;
            }
            String path = paths.getOrDefault(file.id(), file.path());
            String content = file.type().equals("note") ? text(file.objectId()) : null;
            var rewritten = content == null ? null : links.rewrite(content, file.path(), path, byPath, paths);
            if (rewritten != null) for (String warning : rewritten.warnings()) warnings.add(file.path() + "：" + warning);
            if (!path.equals(file.path()) || rewritten != null && !rewritten.content().equals(content)) {
                changes.add(new MovePreviewResponse.Change(file.id(), file.path(), path, Long.toString(file.version()), rewritten == null ? List.of() : rewritten.links()));
                files.add(new FileChange(file, path, rewritten == null ? null : rewritten.content()));
            }
        }
        // Includes the whole path/version catalog: new files or edits after review invalidate the plan too.
        var snapshot = catalog.stream().map(file -> List.of(file.id(), file.path(), file.version(), file.deleted())).toList();
        String fingerprint = digest(json.writeValueAsBytes(List.of(id, target, snapshot, changes, warnings)));
        return new Plan(new MovePreviewResponse(fingerprint, source.path(), target, changes, warnings), files);
    }

    private boolean nested(String path, String parent) { return path.toLowerCase(Locale.ROOT).startsWith(parent.toLowerCase(Locale.ROOT) + "/"); }

    private String text(String objectId) {
        try { return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(objects.read(objectId))).toString(); }
        catch (java.nio.charset.CharacterCodingException exception) { throw new ApiException(400, "UNSUPPORTED_FORMAT", "文件不是有效 UTF-8，未提交移动。"); }
    }

    private String digest(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (java.security.NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }
}
