package com.privatespace.modules.note.service.impl;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.file.service.FileObjectService;
import com.privatespace.modules.note.dto.ImportPreviewResponse;
import com.privatespace.modules.note.dto.ImportPreviewResponse.Entry;
import com.privatespace.modules.note.dto.ImportResultResponse;
import com.privatespace.modules.note.entity.NoteFileEntity;
import com.privatespace.modules.note.mapper.NoteMapper;
import com.privatespace.modules.note.service.NoteImportService;
import com.privatespace.modules.note.service.NotePaths;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.ObjectMapper;

@Service
public class NoteImportServiceImpl implements NoteImportService {
    private final NoteMapper mapper;
    private final FileObjectService objects;
    private final ObjectMapper json;
    private final int maxFiles;
    private final long maxBytes;

    public NoteImportServiceImpl(NoteMapper mapper, FileObjectService objects, ObjectMapper json,
            @Value("${private-space.import.max-files:2000}") int maxFiles,
            @Value("${private-space.import.max-bytes:1073741824}") long maxBytes) {
        this.mapper = mapper;
        this.objects = objects;
        this.json = json;
        this.maxFiles = maxFiles;
        this.maxBytes = maxBytes;
    }

    @Override
    @Transactional
    public ImportPreviewResponse preview(String target, List<String> paths, List<MultipartFile> files) {
        var uploads = inspect(paths, files);
        mapper.lock();
        return plan(target, uploads);
    }

    @Override
    @Transactional
    public ImportResultResponse commit(String target, List<String> paths, List<MultipartFile> files,
            String fingerprint, String operation) {
        UUID.fromString(operation);
        var uploads = inspect(paths, files);
        String hash = digest(json.writeValueAsBytes(List.of(target, fingerprint, identities(uploads))));
        mapper.lock();
        String previous = mapper.previous(operation, "directory-import", hash);
        if (previous != null) return json.readValue(previous, ImportResultResponse.class);
        if (mapper.operationExists(operation, "directory-import") > 0) {
            throw new ApiException(409, "IDEMPOTENCY_CONFLICT", "导入操作对应的内容已变化，请重新预检。");
        }
        var preview = plan(target, uploads);
        if (!preview.canImport()) throw new ApiException(409, "IMPORT_BLOCKED", "目录存在冲突或无效文件，未导入任何内容，请重新预检。");
        if (!preview.fingerprint().equals(fingerprint)) {
            throw new ApiException(409, "PREVIEW_EXPIRED", "文件内容或服务器目录已变化，请重新预检并确认。");
        }
        int folders = 0;
        // Parent directories are published before children, inside the same notebook transaction.
        for (var entry : preview.entries().stream().filter(e -> e.type().equals("folder"))
                .sorted(Comparator.comparingInt(e -> e.path().length())).toList()) {
            if (entry.status().equals("CREATE")) {
                publish(entry.path(), "folder", null, null);
                folders++;
            }
        }
        for (var upload : uploads) {
            byte[] bytes = bytes(upload.file());
            if (!digest(bytes).equals(upload.sha256())) throw new ApiException(409, "CHECKSUM_MISMATCH", "导入文件已变化，未发布本批内容。");
            String type = type(upload.path());
            var object = objects.write(bytes);
            publish(join(target, upload.path()), type, object, type.equals("note") ? text(bytes) : null);
        }
        var result = new ImportResultResponse(uploads.size(), folders, preview.totalBytes());
        mapper.operation(operation, "directory-import", hash, json.writeValueAsString(result));
        return result;
    }

    private List<Upload> inspect(List<String> paths, List<MultipartFile> files) {
        if (paths.isEmpty() || paths.size() != files.size()) throw new ApiException(400, "INVALID_REQUEST", "文件与路径清单不匹配。");
        if (files.size() > maxFiles) throw new ApiException(413, "IMPORT_LIMIT", "本批文件数量超过限制，请拆分目录后导入。");
        long total = files.stream().mapToLong(MultipartFile::getSize).sum();
        if (total > maxBytes) throw new ApiException(413, "IMPORT_LIMIT", "本批总大小超过限制，请拆分目录后导入。");
        var uploads = new ArrayList<Upload>();
        for (int index = 0; index < paths.size(); index++) {
            String path = paths.get(index);
            var file = files.get(index);
            long limit = type(path).equals("note") ? 1048576L : 52428800L;
            String error = file.getSize() > limit ? "文件超限：Markdown 最大 1 MiB，附件最大 50 MiB。" : null;
            String sha = "";
            if (error == null) {
                try (var stream = file.getInputStream()) {
                    var digest = sha256();
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = stream.read(buffer)) != -1) digest.update(buffer, 0, count);
                    sha = HexFormat.of().formatHex(digest.digest());
                } catch (IOException exception) { throw unavailable(); }
                if (type(path).equals("note")) {
                    try { text(bytes(file)); }
                    catch (ApiException exception) { error = exception.getMessage(); }
                }
            }
            uploads.add(new Upload(path, file, sha, error));
        }
        return uploads;
    }

    private ImportPreviewResponse plan(String target, List<Upload> uploads) {
        if (!target.isEmpty()) {
            NotePaths.validate(target);
            var folder = mapper.byPath(target);
            if (folder == null || folder.deleted() || !folder.type().equals("folder") || !folder.path().equals(target)) {
                throw new ApiException(409, "PATH_CONFLICT", "目标目录不存在或已变化，请重新选择。");
            }
        }
        Map<String, Entry> entries = new LinkedHashMap<>();
        for (var upload : uploads) {
            String path = join(target, upload.path());
            try { NotePaths.validate(upload.path()); NotePaths.validate(path); }
            catch (ApiException exception) {
                entries.put("invalid:" + entries.size(), new Entry(path, type(path), upload.file().getSize(), "BLOCKED", exception.getMessage()));
                continue;
            }
            int separator = path.indexOf('/');
            while (separator >= 0) {
                add(entries, path.substring(0, separator), "folder", 0, null);
                separator = path.indexOf('/', separator + 1);
            }
            add(entries, path, type(path), upload.file().getSize(), upload.error());
        }
        // Match the database's case-insensitive, accent-sensitive path uniqueness, including Unicode aliases.
        var collisions = mapper.importCollisions(json.writeValueAsString(entries.values().stream()
                .filter(e -> !e.status().equals("BLOCKED")).map(Entry::path).toList()));
        entries.replaceAll((key, entry) -> collisions.contains(entry.path())
                ? new Entry(entry.path(), entry.type(), entry.size(), "BLOCKED", "本批路径按服务器文件名规则重名。") : entry);
        var catalog = mapper.moveCatalog().stream().map(file -> List.of(file.id(), file.path(), file.version(), file.deleted())).toList();
        String fingerprint = digest(json.writeValueAsBytes(List.of(target, identities(uploads), entries.values(), catalog)));
        return new ImportPreviewResponse(fingerprint, entries.values().stream().noneMatch(e -> e.status().equals("BLOCKED")),
                uploads.stream().mapToLong(u -> u.file().getSize()).sum(), uploads.size(), List.copyOf(entries.values()));
    }

    private void add(Map<String, Entry> entries, String path, String type, long size, String error) {
        String key = path.toLowerCase(Locale.ROOT);
        var prior = entries.get(key);
        if (prior != null) {
            if (!prior.path().equals(path) || !prior.type().equals("folder") || !type.equals("folder")) {
                entries.put(key, new Entry(path, type, size, "BLOCKED", "本批存在重名、大小写或文件/目录冲突。"));
            }
            return;
        }
        var existing = mapper.byPath(path);
        String status = "CREATE";
        String message = type.equals("folder") ? "新建目录" : "新建文件";
        if (existing != null) {
            if (type.equals("folder") && existing.type().equals("folder") && !existing.deleted() && existing.path().equals(path)) {
                status = "REUSE";
                message = "使用已有目录";
            } else error = "同名内容已存在、大小写冲突或位于回收站，不会覆盖。";
        }
        entries.put(key, new Entry(path, type, size, error == null ? status : "BLOCKED", error == null ? message : error));
    }

    private void publish(String path, String type, com.privatespace.modules.file.entity.FileObjectEntity object, String content) {
        String id = UUID.randomUUID().toString();
        mapper.create(new NoteFileEntity(id, path, type, 1, object == null ? null : object.id(), content,
                false, false, null, null, object == null ? 0 : object.size(), object == null ? null : object.sha256()));
        mapper.history(id);
        mapper.change(id);
    }

    private List<List<Object>> identities(List<Upload> uploads) {
        return uploads.stream().map(u -> List.<Object>of(u.path(), u.file().getSize(), u.sha256())).toList();
    }

    private String join(String parent, String child) { return parent.isEmpty() ? child : parent + "/" + child; }
    private String type(String path) { return path.toLowerCase(Locale.ROOT).endsWith(".md") ? "note" : "attachment"; }
    private byte[] bytes(MultipartFile file) {
        try { return file.getBytes(); }
        catch (IOException exception) { throw unavailable(); }
    }
    private String text(byte[] bytes) {
        try { return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString(); }
        catch (CharacterCodingException exception) { throw new ApiException(400, "UNSUPPORTED_FORMAT", "Markdown 不是有效的 UTF-8，未改写原文件。"); }
    }
    private MessageDigest sha256() {
        try { return MessageDigest.getInstance("SHA-256"); }
        catch (java.security.NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }
    private String digest(byte[] bytes) { return HexFormat.of().formatHex(sha256().digest(bytes)); }
    private ApiException unavailable() { return new ApiException(503, "IMPORT_UNAVAILABLE", "无法读取上传文件，请重新选择目录后重试。"); }
    private record Upload(String path, MultipartFile file, String sha256, String error) { }
}
