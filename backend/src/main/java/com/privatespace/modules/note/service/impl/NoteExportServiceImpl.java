package com.privatespace.modules.note.service.impl;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.file.service.FileObjectService;
import com.privatespace.modules.note.mapper.NoteMapper;
import com.privatespace.modules.note.service.NoteExportService;
import com.privatespace.modules.note.service.NotePaths;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class NoteExportServiceImpl implements NoteExportService {
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(NoteExportServiceImpl.class);
    private final NoteMapper mapper;
    private final FileObjectService objects;
    private final TransactionTemplate transactions;

    public NoteExportServiceImpl(NoteMapper mapper, FileObjectService objects, PlatformTransactionManager manager) {
        this.mapper = mapper;
        this.objects = objects;
        this.transactions = new TransactionTemplate(manager);
    }

    @Override
    public Path archive() {
        return archive(true, java.util.List.of());
    }

    @Override
    public Path archive(boolean all, java.util.List<String> ids) {
        // Capture a single committed catalog; immutable content can then be copied without blocking edits.
        var snapshot = transactions.execute(status -> {
            mapper.lock();
            return mapper.moveCatalog().stream().filter(file -> !file.deleted())
                    .sorted(Comparator.comparing(file -> file.path())).toList();
        });
        if (ids == null || ids.size() > 5000 || !all && ids.isEmpty()) throw new ApiException(400, "INVALID_REQUEST", "请选择要导出的文件或目录。");
        var selected = new java.util.LinkedHashSet<String>();
        if (all) snapshot.forEach(file -> selected.add(file.id()));
        else for (String id : ids) {
            var chosen = snapshot.stream().filter(file -> file.id().equals(id)).findFirst()
                    .orElseThrow(() -> new ApiException(409, "EXPORT_SELECTION_CHANGED", "所选文件已删除或不存在，请刷新后重新选择。"));
            selected.add(id);
            if (chosen.type().equals("folder")) snapshot.stream().filter(file -> file.path().startsWith(chosen.path() + "/")).forEach(file -> selected.add(file.id()));
        }
        for (var note : snapshot) {
            if (!selected.contains(note.id()) || !note.type().equals("note")) continue;
            var document = org.commonmark.parser.Parser.builder().build().parse(new String(objects.read(note.objectId()), StandardCharsets.UTF_8));
            document.accept(new org.commonmark.node.AbstractVisitor() {
                public void visit(org.commonmark.node.Image image) { include(image.getDestination()); }
                public void visit(org.commonmark.node.Link link) { include(link.getDestination()); visitChildren(link); }
                private void include(String destination) {
                    try {
                        String raw = destination.split("[?#]", 2)[0];
                        if (raw.startsWith("/") || raw.matches("^[a-zA-Z][a-zA-Z0-9+.-]*:.*")) return;
                        String decoded = java.net.URLDecoder.decode(raw.replace("+", "%2B"), StandardCharsets.UTF_8);
                        var parts = new java.util.ArrayList<String>(java.util.List.of(note.path().split("/")));
                        parts.remove(parts.size() - 1);
                        for (String part : decoded.split("/")) {
                            if (part.equals("..")) { if (parts.isEmpty()) return; parts.remove(parts.size() - 1); }
                            else if (!part.equals(".") && !part.isEmpty()) parts.add(part);
                        }
                        String path = String.join("/", parts);
                        snapshot.stream().filter(file -> file.type().equals("attachment") && file.path().equalsIgnoreCase(path)).forEach(file -> selected.add(file.id()));
                    } catch (IllegalArgumentException ignored) { /* Unsupported URL remains unchanged in the exported Markdown. */ }
                }
            });
        }
        Path archive = null;
        try {
            archive = Files.createTempFile("private-space-export-", ".zip");
            try (var zip = new ZipOutputStream(Files.newOutputStream(archive), StandardCharsets.UTF_8)) {
                for (var file : snapshot) {
                    if (!selected.contains(file.id())) continue;
                    String path = NotePaths.validate(file.path());
                    zip.putNextEntry(new ZipEntry(path + (file.type().equals("folder") ? "/" : "")));
                    if (!file.type().equals("folder")) zip.write(objects.read(file.objectId()));
                    zip.closeEntry();
                }
            }
            return archive;
        } catch (IOException exception) {
            remove(archive);
            throw new ApiException(507, "EXPORT_STORAGE_UNAVAILABLE", "无法生成完整导出，请检查临时磁盘空间和权限。");
        } catch (RuntimeException exception) {
            remove(archive);
            throw exception;
        }
    }

    private void remove(Path archive) {
        if (archive == null) return;
        try { Files.deleteIfExists(archive); }
        catch (IOException exception) { LOG.warn("Temporary export cleanup failed; local storage maintenance required"); }
    }
}
