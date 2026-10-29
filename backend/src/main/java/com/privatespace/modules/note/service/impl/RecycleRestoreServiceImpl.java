package com.privatespace.modules.note.service.impl;

import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.file.service.FileObjectService;
import com.privatespace.modules.note.dto.*;
import com.privatespace.modules.note.entity.*;
import com.privatespace.modules.note.mapper.NoteMapper;
import com.privatespace.modules.note.service.NotePaths;
import com.privatespace.modules.note.service.RecycleRestoreService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class RecycleRestoreServiceImpl implements RecycleRestoreService {
    private final NoteMapper mapper;
    private final FileObjectService objects;
    private final ObjectMapper json;
    private final MarkdownLinkRewriter links = new MarkdownLinkRewriter();

    public RecycleRestoreServiceImpl(NoteMapper mapper, FileObjectService objects, ObjectMapper json) {
        this.mapper = mapper;
        this.objects = objects;
        this.json = json;
    }

    @Override
    @Transactional
    public RecycleCandidatesResponse candidates(String id) {
        mapper.lock();
        var context = context(id);
        var items = context.visible().stream().filter(member -> {
            var file = required(member.fileId());
            return file.type().equals("folder") || pending(member, file);
        }).map(member -> new RecycleCandidatesResponse.Item(member.fileId(), member.path(), required(member.fileId()).type())).toList();
        return new RecycleCandidatesResponse(context.root().id(), context.source().path(), Long.toString(context.root().version()), items);
    }

    @Override
    @Transactional
    public RecycleRestorePreview preview(String id, RecycleRestoreRequest request) {
        mapper.lock();
        return plan(id, request).preview();
    }

    @Override
    @Transactional
    public RecycleRestoreResult restore(String id, RecycleRestoreRequest request, String operation) {
        mapper.lock();
        UUID.fromString(operation);
        String scope = "recycle:" + UUID.fromString(id);
        String hash = digest(json.writeValueAsBytes(request));
        String previous = mapper.previous(operation, scope, hash);
        if (previous != null) return json.readValue(previous, RecycleRestoreResult.class);
        if (mapper.operationExists(operation, scope) > 0) throw conflict("同一恢复操作对应不同内容，请重新预检。");
        var plan = plan(id, request);
        if (!plan.preview().fingerprint().equals(request.fingerprint())) throw conflict("恢复范围、目录或内容已变化，请重新预览并确认。");
        int folders = 0;
        var restored = new ArrayList<String>();
        for (var folder : plan.folders()) {
            if (folder.action().equals("REUSE")) continue;
            String folderId = folder.id() == null ? UUID.randomUUID().toString() : folder.id();
            if (folder.action().equals("CREATE")) {
                mapper.create(new NoteFileEntity(folderId, folder.path(), "folder", 1, null, null, false, false, null, null, 0, null));
            } else {
                mapper.update(folderId, folder.version() + 1, null, null, 0, null, false);
            }
            publish(folderId); restored.add(folderId); folders++;
        }
        for (var file : plan.files()) {
            byte[] original = objects.read(file.objectId());
            byte[] bytes = file.content() == null ? original : file.content().getBytes(StandardCharsets.UTF_8);
            String objectId = file.objectId();
            if (!Arrays.equals(bytes, original)) objectId = objects.write(bytes).id();
            mapper.repath(file.id(), file.toPath());
            mapper.update(file.id(), file.version() + 1, objectId, file.type().equals("note") ? text(bytes) : null, bytes.length, digest(bytes), false);
            publish(file.id()); restored.add(file.id());
        }
        var result = new RecycleRestoreResult(plan.files().size(), folders, restored);
        mapper.operation(operation, scope, hash, json.writeValueAsString(result));
        return result;
    }

    private Plan plan(String id, RecycleRestoreRequest request) {
        if (request == null || request.ids() == null || request.ids().stream().anyMatch(Objects::isNull) || request.ids().size() > 5000
                || request.mode() == null || request.destination() == null
                || !List.of("all", "files").contains(request.mode()) || !List.of("original", "directory").contains(request.destination())) {
            throw new ApiException(400, "INVALID_REQUEST", "请选择恢复范围和位置。");
        }
        var context = context(id);
        if (!Long.toString(context.root().version()).equals(request.baseVersion())) throw conflict("回收站内容已变化，请刷新后重新选择。");
        boolean all = request.mode().equals("all");
        if (all && (!context.root().type().equals("folder") || !request.destination().equals("original"))) {
            throw new ApiException(400, "INVALID_REQUEST", "整个目录只能恢复到原位置。");
        }
        if (all && !context.root().deleted() && !context.root().path().equals(context.source().path())) throw conflict("原目录已移动，请核对原位置后再恢复剩余目录。");
        Map<String, DeleteMemberEntity> allowed = new LinkedHashMap<>();
        for (var member : context.visible()) {
            var current = required(member.fileId());
            if (!current.type().equals("folder") && pending(member, current)) allowed.put(current.id(), member);
        }
        var selected = all ? new TreeSet<>(allowed.keySet()) : new TreeSet<>(request.ids());
        if (!all && selected.isEmpty()) throw new ApiException(400, "INVALID_REQUEST", "请至少选择一个文件。");
        if (!allowed.keySet().containsAll(selected)) throw conflict("所选文件已恢复、已变化或不属于此目录，请重新选择。");
        String target = request.target() == null ? "" : request.target();
        if (request.destination().equals("directory") && !target.isEmpty()) {
            NotePaths.validate(target);
            var directory = mapper.byPath(target);
            if (directory == null || directory.deleted() || !directory.type().equals("folder") || !directory.path().equals(target)) throw conflict("指定目录不存在或已变化。");
        }
        Map<String, FolderAction> folders = new LinkedHashMap<>();
        var catalog = mapper.moveCatalog();
        Map<String, NoteFileEntity> byPath = new HashMap<>();
        catalog.forEach(file -> byPath.put(file.path().toLowerCase(Locale.ROOT), file));
        Map<String, String> destinations = new LinkedHashMap<>();
        for (String fileId : selected) {
            var member = allowed.get(fileId);
            String destination = request.destination().equals("original") ? member.path()
                    : (target.isEmpty() ? "" : target + "/") + member.path().substring(member.path().lastIndexOf('/') + 1);
            NotePaths.validate(destination);
            var occupied = mapper.byPath(destination);
            if (occupied != null && !occupied.id().equals(fileId)) throw new ApiException(409, "PATH_CONFLICT", "恢复位置存在同名内容（含回收站），不会覆盖：" + destination);
            destinations.put(fileId, destination);
            var current = required(fileId);
            // Treat only selected snapshot files as live for relative-link relocation.
            byPath.put(member.path().toLowerCase(Locale.ROOT), new NoteFileEntity(current.id(), member.path(), current.type(), current.version(), current.objectId(), null, false, current.favorite(), current.lastOpenedAt(), current.updatedAt(), current.size(), current.sha256()));
            ensureParent(destination, folders);
        }
        if (!mapper.importCollisions(json.writeValueAsString(destinations.values())).isEmpty()) {
            throw new ApiException(409, "PATH_CONFLICT", "选中的文件同名，放入同一目录会冲突，请调整选择。");
        }
        if (all) {
            for (var member : context.members()) {
                var current = required(member.fileId());
                if (current.type().equals("folder") && pending(member, current)) ensureDirectory(member.path(), folders);
            }
        }
        var actions = new ArrayList<FileAction>();
        var changes = new ArrayList<RecycleRestorePreview.Change>();
        var warnings = new ArrayList<String>();
        for (String fileId : selected) {
            var member = allowed.get(fileId);
            var current = required(fileId);
            var source = mapper.revision(fileId, member.beforeVersion());
            if (source == null || source.deleted() || source.objectId() == null) throw conflict("原始文件历史不完整，未恢复任何内容。");
            String destination = destinations.get(fileId);
            String content = null;
            List<MovePreviewResponse.LinkChange> rewritten = List.of();
            if (current.type().equals("note")) {
                var result = links.rewrite(text(objects.read(source.objectId())), member.path(), destination, byPath, destinations);
                if (request.destination().equals("directory")) { content = result.content(); rewritten = result.links(); }
                for (String warning : result.warnings()) warnings.add(member.path() + "：" + warning);
            }
            changes.add(new RecycleRestorePreview.Change(fileId, member.path(), destination, current.type(), rewritten));
            actions.add(new FileAction(fileId, destination, current.type(), current.version(), source.objectId(), content));
        }
        var directoryActions = folders.values().stream().sorted(Comparator.comparingInt((FolderAction folder) -> folder.path().length()).thenComparing(FolderAction::path)).toList();
        if (actions.isEmpty() && directoryActions.stream().noneMatch(folder -> !folder.action().equals("REUSE"))) throw conflict("没有可恢复的剩余项目，请刷新并核对回收站状态。");
        var directoryPreview = directoryActions.stream().map(folder -> new RecycleRestorePreview.Folder(folder.path(), folder.action())).toList();
        var snapshot = catalog.stream().map(file -> List.of(file.id(), file.path(), file.version(), file.deleted())).toList();
        String fingerprint = digest(json.writeValueAsBytes(List.of(context.root().id(), request.baseVersion(), request.mode(), selected,
                request.destination(), target, changes, directoryPreview, warnings, snapshot)));
        return new Plan(new RecycleRestorePreview(fingerprint, changes, directoryPreview, warnings), actions, directoryActions);
    }

    private Context context(String id) {
        var root = required(UUID.fromString(id).toString());
        List<DeleteMemberEntity> members;
        if (root.type().equals("folder")) {
            long batch = mapper.pendingDeleteBatch(root.id());
            if (batch == 0) {
                if (!root.deleted()) throw conflict("目录已恢复，没有待恢复内容。");
                members = List.of(single(root));
            } else members = mapper.deleteMembers(root.id(), batch);
        } else {
            if (!root.deleted()) throw conflict("文件已恢复，请刷新回收站。");
            var containing = mapper.containingDeleteBatch(root.id(), root.version());
            members = containing == null ? List.of(single(root)) : mapper.deleteMembers(containing.rootId(), containing.rootDeletedVersion());
        }
        var own = members.stream().filter(member -> member.fileId().equals(root.id())).findFirst().orElseThrow();
        return new Context(root, own, members, root.type().equals("folder") ? members : List.of(own));
    }

    private DeleteMemberEntity single(NoteFileEntity file) {
        var source = mapper.latestLiveRevision(file.id());
        if (source == null) throw conflict("删除前历史不存在，无法恢复。");
        return new DeleteMemberEntity(file.id(), file.version(), file.id(), source.version(), file.version(), file.path());
    }

    private boolean pending(DeleteMemberEntity member, NoteFileEntity file) {
        return file.deleted() && file.version() == member.deletedVersion() && file.path().equals(member.path());
    }

    private void ensureParent(String path, Map<String, FolderAction> folders) {
        int slash = path.lastIndexOf('/');
        if (slash >= 0) ensureDirectory(path.substring(0, slash), folders);
    }

    private void ensureDirectory(String path, Map<String, FolderAction> folders) {
        if (path.isEmpty() || folders.containsKey(path)) return;
        NotePaths.validate(path);
        ensureParent(path, folders);
        var directory = mapper.byPath(path);
        if (directory == null) folders.put(path, new FolderAction(null, path, 0, "CREATE"));
        else {
            if (!directory.type().equals("folder") || !directory.path().equals(path)) throw new ApiException(409, "PATH_CONFLICT", "原目录路径被其他内容占用：" + path);
            if (directory.deleted()) {
                var history = mapper.latestLiveRevision(directory.id());
                if (history == null || !history.path().equals(path)) throw conflict("原目录历史缺失，无法补齐路径。");
            }
            folders.put(path, new FolderAction(directory.id(), path, directory.version(), directory.deleted() ? "RESTORE" : "REUSE"));
        }
    }

    private NoteFileEntity required(String id) {
        var file = mapper.find(UUID.fromString(id).toString());
        if (file == null) throw new ApiException(404, "NOT_FOUND", "回收站对象不存在。");
        return file;
    }

    private void publish(String id) { mapper.history(id); mapper.change(id); }
    private String text(byte[] bytes) {
        try { return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString(); }
        catch (java.nio.charset.CharacterCodingException exception) { throw conflict("原始 Markdown 编码无效，未恢复内容。"); }
    }
    private String digest(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (java.security.NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }
    private ApiException conflict(String message) { return new ApiException(409, "RECYCLE_CONFLICT", message); }
    private record Context(NoteFileEntity root, DeleteMemberEntity source, List<DeleteMemberEntity> members, List<DeleteMemberEntity> visible) { }
    private record FileAction(String id, String toPath, String type, long version, String objectId, String content) { }
    private record FolderAction(String id, String path, long version, String action) { }
    private record Plan(RecycleRestorePreview preview, List<FileAction> files, List<FolderAction> folders) { }
}
