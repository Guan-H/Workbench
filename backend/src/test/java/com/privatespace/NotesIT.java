package com.privatespace;

import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Uses the product routes and UI with real MySQL and immutable files, then starts a new server context. */
class NotesIT {
    @TempDir
    Path directory;
    private final String run = UUID.randomUUID().toString();
    private final String setup = UUID.randomUUID() + "-" + UUID.randomUUID();
    private final String password = UUID.randomUUID() + "!aB9";
    private int frontendPort;

    @Test
    void verifiesAuthenticatedNotebookAndRestartPersistence() throws Exception {
        try (var socket = new ServerSocket(0)) { frontendPort = socket.getLocalPort(); }
        if ("1".equals(System.getenv("IT_ONLY_INCREMENTAL"))) seedLegacySyncLog("6");
        if ("1".equals(System.getenv("IT_ONLY_SNAPSHOT"))) seedLegacySyncLog("7");
        try (var context = start()) {
            if ("1".equals(System.getenv("IT_ONLY_PACKAGED_M2"))) {
                packagedDesktop(context, true);
                return;
            }
            if ("1".equals(System.getenv("IT_ONLY_CONFLICT_REPORT"))) {
                initialMerge(context, true);
                conflictStatusBrowser(context);
                if ("1".equals(System.getenv("IT_M2_FINAL"))) {
                    packagedDesktop(context, false);
                    fileRenames(context, false);
                }
                return;
            }
            if ("1".equals(System.getenv("IT_ONLY_MERGE"))) {
                initialMerge(context, true);
                return;
            }
            if ("1".equals(System.getenv("IT_ONLY_SNAPSHOT"))) {
                snapshotPages(context, true);
                return;
            }
            if ("1".equals(System.getenv("IT_ONLY_INCREMENTAL"))) {
                assertThat(context.getBean(com.privatespace.modules.note.mapper.NoteMapper.class).syncFloor()).isEqualTo(1L);
                incremental(context, "initialize");
                purgeSyncFixture(context);
                incremental(context, "purged");
                expireSyncLog(context);
                incremental(context, "expired");
                return;
            }
            if ("1".equals(System.getenv("IT_ONLY_FILE_RENAMES"))) {
                fileRenames(context, true);
                verifyFileRenameRollback(context);
                return;
            }
            var verificationJdbc = context.getBean(JdbcTemplate.class);
            // This constraint exists only in the isolated database and rejects the second file's real INSERT.
            verificationJdbc.execute("ALTER TABLE note_file ADD CONSTRAINT verify_import_failure CHECK (path <> '导入事务/失败.md')");
            try {
                browser(context, "write");
                assertThat(verificationJdbc.queryForObject("SELECT COUNT(*) FROM note_file WHERE path LIKE '导入事务%'", Long.class)).isZero();
            } finally {
                verificationJdbc.execute("ALTER TABLE note_file DROP CHECK verify_import_failure");
            }
            verifyExportIntegrity(context);
            verifyUnrelatedRenamePreview(context);
            if ("1".equals(System.getenv("IT_INCLUDE_SYNC"))) {
                initialMerge(context, false);
                if ("1".equals(System.getenv("IT_M2_FINAL"))) {
                    conflictStatusBrowser(context);
                    packagedDesktop(context, false);
                }
                fileRenames(context, false);
                verifyFileRenameRollback(context);
                incremental(context, "existing");
                purgeSyncFixture(context);
                incremental(context, "purged");
                expireSyncLog(context);
                incremental(context, "expired");
                sync(context, "write");
            }
            verifyMoveRollback(context);
            verifyDirectoryRecycle(context);
            verifySelectiveRecovery(context);
            verifyRetention(context);
            var jdbc = context.getBean(JdbcTemplate.class);
            assertThat(jdbc.queryForObject("SELECT password_hash FROM account WHERE id = 1", String.class))
                    .startsWith("$2a$").doesNotContain(password);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM note_revision", Long.class)).isGreaterThan(4L);
            try (var files = Files.walk(directory.resolve("objects"))) {
                assertThat(files.filter(Files::isRegularFile).count()).isGreaterThan(2L);
            }
        }
        try (var context = start()) {
            browser(context, "restore");
            if ("1".equals(System.getenv("IT_INCLUDE_SYNC"))) sync(context, "restore");
            if ("1".equals(System.getenv("IT_INCLUDE_SYNC"))) snapshotPages(context, false);
        }
    }

    private void verifyRetention(ConfigurableApplicationContext context) throws Exception {
        var notes = context.getBean(com.privatespace.modules.note.service.NoteService.class);
        var cleanup = context.getBean(com.privatespace.modules.note.service.RetentionService.class);
        var objects = context.getBean(com.privatespace.modules.file.service.FileObjectService.class);
        var objectMapper = context.getBean(com.privatespace.modules.file.mapper.FileObjectMapper.class);
        var jdbc = context.getBean(JdbcTemplate.class);
        var active = notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("保留清理-活跃.md", "note", "旧版本", null), UUID.randomUUID().toString());
        active = notes.save(active.id(), new com.privatespace.modules.note.dto.WriteNoteRequest(active.path(), "note", "中间版本", active.version()), UUID.randomUUID().toString());
        active = notes.save(active.id(), new com.privatespace.modules.note.dto.WriteNoteRequest(active.path(), "note", "当前版本", active.version()), UUID.randomUUID().toString());
        String expiredHistoryObject = jdbc.queryForObject("SELECT object_id FROM note_revision WHERE file_id = ? AND version = 1", String.class, active.id());

        var protectedRoot = notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("保留清理-受保护", "folder", "", null), UUID.randomUUID().toString());
        var protectedChild = notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("保留清理-受保护/内容.md", "note", "快照必须可恢复", null), UUID.randomUUID().toString());
        String protectedObject = jdbc.queryForObject("SELECT object_id FROM note_file WHERE id = ?", String.class, protectedChild.id());
        var protectedDeleted = notes.delete(protectedRoot.id(), protectedRoot.version(), UUID.randomUUID().toString());

        var expiredFile = notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("保留清理-到期.md", "note", "到期回收站", null), UUID.randomUUID().toString());
        notes.delete(expiredFile.id(), expiredFile.version(), UUID.randomUUID().toString());
        var expiredRoot = notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("保留清理-到期目录", "folder", "", null), UUID.randomUUID().toString());
        var expiredChild = notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("保留清理-到期目录/内容.md", "note", "目录到期", null), UUID.randomUUID().toString());
        notes.delete(expiredRoot.id(), expiredRoot.version(), UUID.randomUUID().toString());

        var leased = objects.write("导出租约保护".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        objectMapper.lease(UUID.randomUUID().toString(), leased.id(), java.time.LocalDateTime.now(java.time.ZoneOffset.UTC).plusHours(1));
        Path physicalOrphan = objectPath(UUID.randomUUID().toString());
        Files.createDirectories(physicalOrphan.getParent());
        Files.writeString(physicalOrphan, "事务回滚遗留对象");

        jdbc.update("UPDATE note_revision SET created_at = UTC_TIMESTAMP(6) - INTERVAL 40 DAY WHERE file_id = ? AND version = 1", active.id());
        jdbc.update("UPDATE note_revision SET created_at = UTC_TIMESTAMP(6) - INTERVAL 40 DAY WHERE file_id = ? AND version = 1", protectedChild.id());
        jdbc.update("UPDATE note_file SET updated_at = UTC_TIMESTAMP(6) - INTERVAL 40 DAY WHERE id IN (?, ?, ?)", expiredFile.id(), expiredRoot.id(), expiredChild.id());
        jdbc.update("UPDATE note_revision SET created_at = UTC_TIMESTAMP(6) - INTERVAL 40 DAY WHERE file_id IN (?, ?, ?)", expiredFile.id(), expiredRoot.id(), expiredChild.id());
        jdbc.update("UPDATE file_object SET created_at = UTC_TIMESTAMP(6) - INTERVAL 40 DAY WHERE id IN (?, ?)", expiredHistoryObject, leased.id());
        Files.setLastModifiedTime(physicalOrphan, java.nio.file.attribute.FileTime.from(java.time.Instant.now().minus(java.time.Duration.ofDays(40))));

        var result = cleanup.cleanup();
        assertThat(result.trashFiles()).isGreaterThanOrEqualTo(3);
        assertThat(result.revisions()).isGreaterThanOrEqualTo(1);
        assertThat(result.physicalOrphans()).isGreaterThanOrEqualTo(1);
        assertThat(notes.read(active.id(), false).content()).isEqualTo("当前版本");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM note_revision WHERE file_id = ? AND version = 1", Long.class, active.id())).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM file_object WHERE id = ?", Long.class, expiredHistoryObject)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM note_revision WHERE file_id = ? AND version = 1", Long.class, protectedChild.id())).isOne();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM file_object WHERE id = ?", Long.class, protectedObject)).isOne();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM note_file WHERE id IN (?, ?, ?)", Long.class, expiredFile.id(), expiredRoot.id(), expiredChild.id())).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM note_delete_member WHERE root_id = ?", Long.class, expiredRoot.id())).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM file_object WHERE id = ?", Long.class, leased.id())).isOne();
        assertThat(physicalOrphan).doesNotExist();

        var restored = notes.restore(protectedRoot.id(), protectedRoot.version(), protectedDeleted.version(), UUID.randomUUID().toString());
        assertThat(restored.deleted()).isFalse();
        assertThat(notes.read(protectedChild.id(), false).content()).isEqualTo("快照必须可恢复");
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("保留清理-到期.md", "note", "路径已释放", null), UUID.randomUUID().toString());

        jdbc.update("DELETE FROM file_object_lease WHERE object_id = ?", leased.id());
        var released = cleanup.cleanup();
        assertThat(released.databaseObjects()).isGreaterThanOrEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM file_object WHERE id = ?", Long.class, leased.id())).isZero();
        assertThat(objectPath(leased.id())).doesNotExist();
    }

    private Path objectPath(String id) {
        return directory.resolve("objects").resolve(id.substring(0, 2)).resolve(id);
    }

    private void verifySelectiveRecovery(ConfigurableApplicationContext context) {
        var notes = context.getBean(com.privatespace.modules.note.service.NoteService.class);
        var recycle = context.getBean(com.privatespace.modules.note.service.RecycleRestoreService.class);
        var jdbc = context.getBean(JdbcTemplate.class);
        var root = notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("部分恢复", "folder", "", null), UUID.randomUUID().toString());
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("部分恢复/子1", "folder", "", null), UUID.randomUUID().toString());
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("部分恢复/子2", "folder", "", null), UUID.randomUUID().toString());
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("部分恢复/空目录", "folder", "", null), UUID.randomUUID().toString());
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("恢复接收", "folder", "", null), UUID.randomUUID().toString());
        var first = notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("部分恢复/子1/文档.md", "note", "\uFEFF---\r\ntitle: 保留\r\n---\r\n![图](../子2/图.png)\r\n", null), UUID.randomUUID().toString());
        var second = notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("部分恢复/子2/保留.md", "note", "原始文本\r\n", null), UUID.randomUUID().toString());
        var duplicate = notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("部分恢复/子2/文档.md", "note", "同名内容不得覆盖", null), UUID.randomUUID().toString());
        byte[] binary = new byte[]{0, 1, -1, -128, 12};
        var image = notes.upload("部分恢复/子2/图.png", binary, UUID.randomUUID().toString());
        notes.delete(root.id(), root.version(), UUID.randomUUID().toString());
        var candidates = recycle.candidates(root.id());
        var collision = new com.privatespace.modules.note.dto.RecycleRestoreRequest(candidates.baseVersion(), "files", java.util.List.of(first.id(), duplicate.id()), "directory", "恢复接收", null);
        assertThatThrownBy(() -> recycle.preview(root.id(), collision)).isInstanceOf(com.privatespace.common.exception.ApiException.class).hasMessageContaining("同名");
        var request = new com.privatespace.modules.note.dto.RecycleRestoreRequest(candidates.baseVersion(), "files", java.util.List.of(first.id(), image.id()), "directory", "恢复接收", null);
        var preview = recycle.preview(root.id(), request);
        assertThat(notes.read(first.id(), false).deleted()).isTrue();
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("恢复预检后新增", "folder", "", null), UUID.randomUUID().toString());
        var stale = reviewed(request, preview.fingerprint());
        assertThatThrownBy(() -> recycle.restore(root.id(), stale, UUID.randomUUID().toString())).isInstanceOf(com.privatespace.common.exception.ApiException.class);
        var ready = reviewed(request, recycle.preview(root.id(), request).fingerprint());
        String operation = UUID.randomUUID().toString();
        String failId = first.id().compareTo(image.id()) > 0 ? first.id() : image.id();
        jdbc.execute("ALTER TABLE note_change ADD CONSTRAINT verify_selective_restore CHECK (NOT(file_id = '" + failId + "' AND version = 3 AND deleted = FALSE))");
        try {
            assertThatThrownBy(() -> recycle.restore(root.id(), ready, operation)).isInstanceOf(org.springframework.dao.DataAccessException.class);
            assertThat(notes.read(first.id(), false).deleted()).isTrue();
            assertThat(notes.read(first.id(), false).path()).isEqualTo(first.path());
            assertThat(notes.read(image.id(), false).deleted()).isTrue();
            assertThat(notes.read(image.id(), false).path()).isEqualTo(image.path());
        } finally { jdbc.execute("ALTER TABLE note_change DROP CHECK verify_selective_restore"); }
        var moved = recycle.restore(root.id(), ready, operation);
        assertThat(recycle.restore(root.id(), ready, operation)).isEqualTo(moved);
        assertThat(notes.read(first.id(), false).version()).isEqualTo("3");
        assertThat(notes.read(first.id(), false).path()).isEqualTo("恢复接收/文档.md");
        assertThat(notes.read(first.id(), false).content()).startsWith("\uFEFF---\r\ntitle: 保留\r\n---\r\n").contains("%E5%9B%BE.png");
        assertThat(notes.download("恢复接收/图.png")).containsExactly(binary);
        assertThat(recycle.candidates(root.id()).items()).noneMatch(item -> item.id().equals(first.id()) || item.id().equals(image.id()));
        var original = new com.privatespace.modules.note.dto.RecycleRestoreRequest(recycle.candidates(root.id()).baseVersion(), "files", java.util.List.of(second.id()), "original", "", null);
        recycle.restore(root.id(), reviewed(original, recycle.preview(root.id(), original).fingerprint()), UUID.randomUUID().toString());
        assertThat(notes.read(second.id(), false).content()).isEqualTo(second.content());
        assertThat(notes.read(root.id(), false).deleted()).isFalse();
        var grouped = (java.util.List<com.privatespace.modules.note.dto.NoteResponse>) notes.list(true, "", "部分恢复", true).get("items");
        assertThat(grouped).anyMatch(item -> item.id().equals(root.id()) && !item.deleted());
        var all = new com.privatespace.modules.note.dto.RecycleRestoreRequest(recycle.candidates(root.id()).baseVersion(), "all", java.util.List.of(), "original", "", null);
        recycle.restore(root.id(), reviewed(all, recycle.preview(root.id(), all).fingerprint()), UUID.randomUUID().toString());
        assertThat(notes.read(duplicate.id(), false).deleted()).isFalse();
        assertThat(notes.read(first.id(), false).path()).isEqualTo("恢复接收/文档.md");
        assertThat((java.util.List<?>) notes.list(true, "", "部分恢复", true).get("items")).isEmpty();
    }

    private com.privatespace.modules.note.dto.RecycleRestoreRequest reviewed(com.privatespace.modules.note.dto.RecycleRestoreRequest request, String fingerprint) {
        return new com.privatespace.modules.note.dto.RecycleRestoreRequest(request.baseVersion(), request.mode(), request.ids(), request.destination(), request.target(), fingerprint);
    }

    private void verifyDirectoryRecycle(ConfigurableApplicationContext context) {
        var notes = context.getBean(com.privatespace.modules.note.service.NoteService.class);
        var jdbc = context.getBean(JdbcTemplate.class);
        var root = notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("目录事务测试", "folder", "", null), UUID.randomUUID().toString());
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("目录事务测试/子", "folder", "", null), UUID.randomUUID().toString());
        var note = notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("目录事务测试/子/原样.md", "note", "\uFEFF---\r\ntitle: 中文\r\n---\r\n# 保留内容\r\n", null), UUID.randomUUID().toString());
        byte[] bytes = new byte[]{0, 1, -1, 3, -128};
        var binary = notes.upload("目录事务测试/附件.bin", bytes, UUID.randomUUID().toString());
        var stale = notes.deletePreview(root.id(), root.version());
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("目录事务测试/新增.md", "note", "新建后须再次确认", null), UUID.randomUUID().toString());
        assertThatThrownBy(() -> notes.delete(root.id(), root.version(), UUID.randomUUID().toString(), stale.fingerprint()))
                .isInstanceOf(com.privatespace.common.exception.ApiException.class);
        assertThat(notes.read(note.id(), false).deleted()).isFalse();
        var plan = notes.deletePreview(root.id(), root.version());
        String operation = UUID.randomUUID().toString();
        // Reject the last subtree publication in real SQL, after earlier rows have already changed.
        jdbc.execute("ALTER TABLE note_change ADD CONSTRAINT verify_tree_delete CHECK (NOT(file_id = '" + binary.id() + "' AND deleted = TRUE))");
        try {
            assertThatThrownBy(() -> notes.delete(root.id(), root.version(), operation, plan.fingerprint())).isInstanceOf(org.springframework.dao.DataAccessException.class);
            for (var target : plan.targets()) assertThat(notes.read(target.id(), false).deleted()).isFalse();
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM note_delete_member WHERE root_id = ?", Long.class, root.id())).isZero();
        } finally { jdbc.execute("ALTER TABLE note_change DROP CHECK verify_tree_delete"); }
        var deleted = notes.delete(root.id().toUpperCase(java.util.Locale.ROOT), root.version(), operation, plan.fingerprint());
        assertThat(notes.delete(root.id().toUpperCase(java.util.Locale.ROOT), root.version(), operation, plan.fingerprint()).version()).isEqualTo(deleted.version());
        for (var target : plan.targets()) assertThat(notes.read(target.id(), false).deleted()).isTrue();
        String restore = UUID.randomUUID().toString();
        jdbc.execute("ALTER TABLE note_change ADD CONSTRAINT verify_tree_restore CHECK (NOT(file_id = '" + binary.id() + "' AND version = 3 AND deleted = FALSE))");
        try {
            assertThatThrownBy(() -> notes.restore(root.id(), root.version(), deleted.version(), restore)).isInstanceOf(org.springframework.dao.DataAccessException.class);
            for (var target : plan.targets()) assertThat(notes.read(target.id(), false).deleted()).isTrue();
        } finally { jdbc.execute("ALTER TABLE note_change DROP CHECK verify_tree_restore"); }
        var restored = notes.restore(root.id().toUpperCase(java.util.Locale.ROOT), root.version(), deleted.version(), restore);
        assertThat(notes.restore(root.id().toUpperCase(java.util.Locale.ROOT), root.version(), deleted.version(), restore).version()).isEqualTo(restored.version());
        for (var target : plan.targets()) {
            assertThat(notes.read(target.id(), false).deleted()).isFalse();
            assertThat(notes.read(target.id(), false).path()).isEqualTo(target.path());
        }
        assertThat(notes.read(note.id(), false).content()).isEqualTo(note.content());
        assertThat(notes.download(binary.path())).containsExactly(bytes);
    }

    private void verifyExportIntegrity(ConfigurableApplicationContext context) throws Exception {
        var mapper = context.getBean(com.privatespace.modules.note.mapper.NoteMapper.class);
        var exports = context.getBean(com.privatespace.modules.note.service.NoteExportService.class);
        var file = mapper.byPath("批量目录/assets/可视图.png");
        Path object = directory.resolve("objects").resolve(file.objectId().substring(0, 2)).resolve(file.objectId());
        byte[] original = Files.readAllBytes(object);
        try {
            Files.write(object, new byte[]{0, 1, 2});
            assertThatThrownBy(exports::archive).isInstanceOf(com.privatespace.common.exception.ApiException.class)
                    .hasMessageContaining("文件读取或校验失败");
        } finally {
            Files.write(object, original);
        }
        Path archive = exports.archive();
        try (var zip = new java.util.zip.ZipFile(archive.toFile(), java.nio.charset.StandardCharsets.UTF_8)) {
            assertThat(zip.getInputStream(zip.getEntry(file.path())).readAllBytes()).containsExactly(original);
        } finally {
            Files.deleteIfExists(archive);
        }
    }

    private void verifyUnrelatedRenamePreview(ConfigurableApplicationContext context) {
        var notes = context.getBean(com.privatespace.modules.note.service.NoteService.class);
        var moves = context.getBean(com.privatespace.modules.note.service.NoteMoveService.class);
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("CaseScope", "folder", "", null), UUID.randomUUID().toString());
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("CaseScope/Asset.md", "note", "# 无关目标\n", null), UUID.randomUUID().toString());
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("无关引用.md", "note",
                "[大小写不同但无关](casescope/asset.md)\n[[完全无关]]\n<img src=\"casescope/asset.md\">\n", null), UUID.randomUUID().toString());
        var source = notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("CCCCCCCCCC.md", "note", "", null), UUID.randomUUID().toString());

        var preview = moves.preview(source.id(), new com.privatespace.modules.note.dto.MoveNoteRequest(
                "DDDDDDDDDD.md", source.version(), null));

        assertThat(preview.changes()).singleElement().satisfies(change -> {
            assertThat(change.id()).isEqualTo(source.id());
            assertThat(change.fromPath()).isEqualTo("CCCCCCCCCC.md");
            assertThat(change.toPath()).isEqualTo("DDDDDDDDDD.md");
            assertThat(change.links()).isEmpty();
        });
        assertThat(preview.warnings()).isEmpty();
    }

    private void verifyMoveRollback(ConfigurableApplicationContext context) {
        var notes = context.getBean(com.privatespace.modules.note.service.NoteService.class);
        var moves = context.getBean(com.privatespace.modules.note.service.NoteMoveService.class);
        var jdbc = context.getBean(JdbcTemplate.class);
        var source = notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("事务源.md", "note", "# 保留源内容\r\n", null), UUID.randomUUID().toString());
        var reference = notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("事务引用.md", "note", "[源](事务源.md)\r\n", null), UUID.randomUUID().toString());
        var request = new com.privatespace.modules.note.dto.MoveNoteRequest("事务新名.md", source.version(), null);
        var preview = moves.preview(source.id(), request);
        var reviewed = new com.privatespace.modules.note.dto.MoveNoteRequest(request.targetPath(), request.baseVersion(), preview.fingerprint());
        var last = preview.changes().get(preview.changes().size() - 1);
        long nextVersion = Long.parseLong(last.baseVersion()) + 1;
        // A real duplicate history key forces failure after earlier files in the same transaction changed.
        jdbc.update("INSERT INTO note_revision (file_id, version, object_id, path, deleted) SELECT id, ?, object_id, path, deleted FROM note_file WHERE id = ?", nextVersion, last.id());
        String operation = UUID.randomUUID().toString();
        try {
            assertThatThrownBy(() -> moves.move(source.id(), reviewed, operation)).isInstanceOf(org.springframework.dao.DuplicateKeyException.class);
            assertThat(notes.read(source.id(), false).path()).isEqualTo(source.path());
            assertThat(notes.read(source.id(), false).content()).isEqualTo(source.content());
            assertThat(notes.read(reference.id(), false).content()).isEqualTo(reference.content());
            assertThat(notes.read(reference.id(), false).version()).isEqualTo(reference.version());
        } finally {
            jdbc.update("DELETE FROM note_revision WHERE file_id = ? AND version = ?", last.id(), nextVersion);
        }
        assertThat(moves.move(source.id(), reviewed, operation).path()).isEqualTo("事务新名.md");
    }

    private ConfigurableApplicationContext start() throws Exception {
        String url = System.getenv("IT_DB_URL");
        if (url == null || !url.matches("jdbc:mysql://[^/]+/private_space_it(?:\\?.*)?")) {
            throw new IllegalStateException("Notebook verification requires private_space_it");
        }
        var properties = new HashMap<String, Object>();
        properties.put("spring.datasource.url", url);
        properties.put("spring.datasource.username", System.getenv("IT_DB_USERNAME"));
        properties.put("spring.datasource.password", System.getenv("IT_DB_PASSWORD"));
        properties.put("private-space.storage.path", Files.createDirectories(directory.resolve("objects")).toString());
        properties.put("private-space.setup-token", setup);
        properties.put("private-space.allowed-origins", "http://127.0.0.1:" + frontendPort);
        properties.put("server.port", "0");
        return new SpringApplicationBuilder(PrivateSpaceApplication.class)
                .initializers(context -> context.getEnvironment().getPropertySources()
                        .addFirst(new MapPropertySource("notes-it", properties))).run();
    }

    private void browser(ConfigurableApplicationContext context, String phase) throws Exception {
        int port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
        Path log = directory.resolve(phase + ".log");
        var builder = new ProcessBuilder("node", "scripts/check-notes.mjs", phase)
                .directory(Path.of("../frontend").toFile()).redirectErrorStream(true).redirectOutput(log.toFile());
        builder.environment().put("NOTES_BACKEND", "http://127.0.0.1:" + port);
        builder.environment().put("NOTES_FRONTEND_PORT", Integer.toString(frontendPort));
        builder.environment().put("NOTES_RUN", run);
        builder.environment().put("NOTES_SETUP", setup);
        builder.environment().put("NOTES_PASSWORD", password);
        Process process = builder.start();
        boolean finished = process.waitFor(Duration.ofMinutes(7).toSeconds(), TimeUnit.SECONDS);
        if (!finished) process.destroyForcibly();
        assertThat(finished).as("Notebook browser timeout").isTrue();
        assertThat(process.exitValue()).as(Files.readString(log)).isZero();
        assertThat(Files.readString(log)).contains("PASS: notes-" + phase);
    }

    private void sync(ConfigurableApplicationContext context, String phase) throws Exception {
        int port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
        Path output = Path.of("../frontend/test-results/sync-" + run).toAbsolutePath().normalize();
        Files.createDirectories(output);
        Path log = output.resolve(phase + ".log");
        var builder = new ProcessBuilder("python", "verification/check_sync.py", phase)
                .directory(Path.of("../sync-client").toFile()).redirectErrorStream(true).redirectOutput(log.toFile());
        builder.environment().put("NOTES_BACKEND", "http://127.0.0.1:" + port);
        builder.environment().put("NOTES_FRONTEND_PORT", Integer.toString(frontendPort));
        builder.environment().put("NOTES_PASSWORD", password);
        builder.environment().put("M0_SYNC_OUTPUT", output.toString());
        builder.environment().put("M0_STORAGE_PATH", directory.resolve("objects").toString());
        if ("1".equals(System.getenv("IT_USE_PACKAGED_SYNC"))) {
            Path executable = Path.of("../sync-client/dist/privatespace-sync-m0/privatespace-sync-m0.exe").toAbsolutePath().normalize();
            assertThat(executable).isRegularFile();
            builder.environment().put("M0_SYNC_EXECUTABLE", executable.toString());
        }
        Process process = builder.start();
        boolean finished = process.waitFor(4, TimeUnit.MINUTES);
        if (!finished) process.destroyForcibly();
        assertThat(finished).as("Sync prototype timed out").isTrue();
        assertThat(process.exitValue()).as(Files.readString(log)).isZero();
        assertThat(Files.readString(log)).contains("PASS: sync-" + phase);
    }

    private void verifyFileRenameRollback(ConfigurableApplicationContext context) {
        var notes = context.getBean(com.privatespace.modules.note.service.NoteService.class);
        var jdbc = context.getBean(JdbcTemplate.class);
        var source = notes.upload("改名事务原文件.txt", "# rollback\r\n".getBytes(java.nio.charset.StandardCharsets.UTF_8), UUID.randomUUID().toString());
        var request = new com.privatespace.modules.note.dto.SyncRenameRequest(source.id(), source.path(), "改名事务新目录/新文件.md",
                source.version(), source.sha256(), null);
        jdbc.update("INSERT INTO note_revision (file_id, version, object_id, path, deleted) SELECT id, version + 1, object_id, path, deleted FROM note_file WHERE id = ?", source.id());
        try {
            assertThatThrownBy(() -> notes.syncRename(request, UUID.randomUUID().toString(), UUID.randomUUID().toString()))
                    .isInstanceOf(org.springframework.dao.DuplicateKeyException.class);
            assertThat(notes.read(source.id(), false).path()).isEqualTo(source.path());
            assertThat(notes.read(source.id(), false).type()).isEqualTo("attachment");
            assertThat(notes.read(source.id(), false).version()).isEqualTo(source.version());
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM note_file WHERE path = '改名事务新目录'", Long.class)).isZero();
        } finally {
            jdbc.update("DELETE FROM note_revision WHERE file_id = ? AND version = 2", source.id());
        }
        assertThat(notes.syncRename(request, UUID.randomUUID().toString(), UUID.randomUUID().toString()).id()).isEqualTo(source.id());
    }

    private void expireSyncLog(ConfigurableApplicationContext context) {
        var jdbc = context.getBean(JdbcTemplate.class);
        var mapper = context.getBean(com.privatespace.modules.note.mapper.NoteMapper.class);
        context.getBean(com.privatespace.modules.note.service.NoteService.class).create(
                new com.privatespace.modules.note.dto.WriteNoteRequest("增量过期边界.md", "note", "# expiry boundary", null), UUID.randomUUID().toString());
        long head = mapper.syncCursor();
        // Move only the isolated log's timestamps; prune through the actual production cleanup service.
        jdbc.update("UPDATE note_change SET created_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 100 DAY)");
        var retention = context.getBean(com.privatespace.modules.note.service.RetentionService.class);
        while (jdbc.queryForObject("SELECT COUNT(*) FROM note_change", Long.class) > 0) retention.cleanup();
        assertThat(mapper.syncFloor()).isEqualTo(head);
        assertThat(mapper.syncCursor()).isEqualTo(head);
        var notes = context.getBean(com.privatespace.modules.note.service.NoteService.class);
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("增量清理后.md", "note", "# after prune", null), UUID.randomUUID().toString());
        assertThat(mapper.syncCursor()).isGreaterThan(head);
    }

    private void purgeSyncFixture(ConfigurableApplicationContext context) {
        var jdbc = context.getBean(JdbcTemplate.class);
        assertThat(jdbc.update("UPDATE note_file SET updated_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 40 DAY) WHERE path = '增量选择/待过期删除.md' AND deleted = TRUE")).isEqualTo(1);
        context.getBean(com.privatespace.modules.note.service.RetentionService.class).cleanup();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM note_file WHERE path = '增量选择/待过期删除.md'", Long.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM note_change WHERE purged = TRUE", Long.class)).isGreaterThan(0L);
    }

    private void seedLegacySyncLog(String target) {
        String url = System.getenv("IT_DB_URL");
        if (url == null || !url.matches("jdbc:mysql://127\\.0\\.0\\.1:[0-9]+/private_space_it(?:\\?.*)?")) {
            throw new IllegalStateException("Migration fixture requires the local isolated integration database");
        }
        var legacy = org.flywaydb.core.Flyway.configure().dataSource(url, System.getenv("IT_DB_USERNAME"), System.getenv("IT_DB_PASSWORD"))
                .locations("filesystem:../database/migrations").target(target).load();
        assertThat(legacy.info().current()).as("Migration fixture requires an empty isolated database").isNull();
        legacy.migrate();
        var jdbc = new JdbcTemplate(new org.springframework.jdbc.datasource.DriverManagerDataSource(
                System.getenv("IT_DB_URL"), System.getenv("IT_DB_USERNAME"), System.getenv("IT_DB_PASSWORD")));
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO note_file (id, path, type, version) VALUES (?, 'V6迁移旧目录', 'folder', 1)", id);
        jdbc.update("INSERT INTO note_change (file_id, version, deleted) VALUES (?, 1, FALSE)", id);
    }

    private void snapshotPages(ConfigurableApplicationContext context, boolean initialize) throws Exception {
        var notes = context.getBean(com.privatespace.modules.note.service.NoteService.class);
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("分页验证", "folder", "", null), UUID.randomUUID().toString());
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("分页其他", "folder", "", null), UUID.randomUUID().toString());
        assertThat(notes.syncAttachmentPaths(java.util.List.of("分页验证"))).isEmpty();
        // Every fixture goes through the real publication transaction; no synthetic API response or direct metadata INSERT.
        for (int index = 0; index < 5005; index++) {
            notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("分页验证/空目录" + index, "folder", "", null), UUID.randomUUID().toString());
        }
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("分页验证/正文.md", "note", "# 原始正文\r\n\r\n[附件](../分页其他/附件.bin)\r\n", null), UUID.randomUUID().toString());
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("分页验证/删除.md", "note", "# 保留删除前字节\r\n", null), UUID.randomUUID().toString());
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("分页其他/不选.md", "note", "# 范围外正文", null), UUID.randomUUID().toString());
        notes.upload("分页其他/附件.bin", "shared attachment\r\n".getBytes(java.nio.charset.StandardCharsets.UTF_8), UUID.randomUUID().toString());
        int port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
        Path output = Path.of("../frontend/test-results/snapshot-pages-" + run).toAbsolutePath().normalize();
        Files.createDirectories(output);
        runSnapshotPages(output, port, initialize ? "initialize" : "existing");
        var state = context.getBean(tools.jackson.databind.ObjectMapper.class).readTree(Files.readString(output.resolve("expiry.json")));
        var jdbc = context.getBean(JdbcTemplate.class);
        assertThat(jdbc.update("UPDATE sync_snapshot SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE id = ?", state.get("snapshot").asText())).isOne();
        runSnapshotPages(output, port, "expired");
        // Starting a new bootstrap also reclaims expired metadata pages through the FK cascade.
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM sync_snapshot_item WHERE snapshot_id = ?", Long.class, state.get("snapshot").asText())).isZero();
        // SQL candidate filtering must retain the exact path-prefix semantics of the existing Java scope.
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("分页ScopeCase", "folder", "", null), UUID.randomUUID().toString());
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("分页scopecase/范围外.md", "note", "[附件](../分页其他/附件.bin)", null), UUID.randomUUID().toString());
        assertThat(notes.syncAttachmentPaths(java.util.List.of("分页ScopeCase"))).isEmpty();
    }

    private void runSnapshotPages(Path output, int port, String phase) throws Exception {
        Path log = output.resolve(phase + ".log");
        var builder = new ProcessBuilder("python", "verification/check_snapshot_pages.py", phase)
                .directory(Path.of("../sync-client").toFile()).redirectErrorStream(true).redirectOutput(log.toFile());
        builder.environment().put("NOTES_BACKEND", "http://127.0.0.1:" + port);
        builder.environment().put("NOTES_FRONTEND_PORT", Integer.toString(frontendPort));
        builder.environment().put("NOTES_PASSWORD", password);
        builder.environment().put("NOTES_SETUP", setup);
        builder.environment().put("SNAPSHOT_OUTPUT", output.toString());
        builder.environment().put("PYTHONIOENCODING", "utf-8");
        Process process = builder.start();
        boolean finished = process.waitFor(6, TimeUnit.MINUTES);
        if (!finished) process.destroyForcibly();
        assertThat(finished).as("Snapshot page verification timed out").isTrue();
        assertThat(process.exitValue()).as(Files.readString(log)).isZero();
        assertThat(Files.readString(log)).contains("PASS: snapshot-pages-" + phase);
    }

    private void incremental(ConfigurableApplicationContext context, String phase) throws Exception {
        int port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
        Path output = Path.of("../frontend/test-results/incremental-" + run).toAbsolutePath().normalize();
        Files.createDirectories(output);
        Path log = output.resolve(phase + ".log");
        var builder = new ProcessBuilder("python", "verification/check_incremental.py", phase)
                .directory(Path.of("../sync-client").toFile()).redirectErrorStream(true).redirectOutput(log.toFile());
        builder.environment().put("NOTES_BACKEND", "http://127.0.0.1:" + port);
        builder.environment().put("NOTES_FRONTEND_PORT", Integer.toString(frontendPort));
        builder.environment().put("NOTES_PASSWORD", password);
        builder.environment().put("NOTES_SETUP", setup);
        builder.environment().put("INCREMENTAL_OUTPUT", output.toString());
        builder.environment().put("PYTHONIOENCODING", "utf-8");
        Process process = builder.start();
        boolean finished = process.waitFor(3, TimeUnit.MINUTES);
        if (!finished) process.destroyForcibly();
        assertThat(finished).as("Incremental verification timed out").isTrue();
        assertThat(process.exitValue()).as(Files.readString(log)).isZero();
        assertThat(Files.readString(log)).contains("PASS: incremental-" + phase);
    }

    private void initialMerge(ConfigurableApplicationContext context, boolean initialize) throws Exception {
        var notes = context.getBean(com.privatespace.modules.note.service.NoteService.class);
        notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("合并清理", "folder", "", null), UUID.randomUUID().toString());
        var expired = notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest("合并清理/已过期.md", "note", "真实到期删除", null), UUID.randomUUID().toString());
        notes.delete(expired.id(), expired.version(), UUID.randomUUID().toString());
        // Age only this isolated fixture; actual retention code emits the purged tombstone.
        var jdbc = context.getBean(JdbcTemplate.class);
        jdbc.update("UPDATE note_file SET updated_at = UTC_TIMESTAMP(6) - INTERVAL 40 DAY WHERE id = ?", expired.id());
        context.getBean(com.privatespace.modules.note.service.RetentionService.class).cleanup();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM note_file WHERE id = ?", Long.class, expired.id())).isZero();
        int port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
        Path output = Path.of("../frontend/test-results/initial-merge-" + run).toAbsolutePath().normalize();
        Files.createDirectories(output);
        Path log = output.resolve("verification.log");
        var builder = new ProcessBuilder("python", "verification/check_initial_merge.py", initialize ? "initialize" : "existing")
                .directory(Path.of("../sync-client").toFile()).redirectErrorStream(true).redirectOutput(log.toFile());
        builder.environment().put("NOTES_BACKEND", "http://127.0.0.1:" + port);
        builder.environment().put("NOTES_FRONTEND_PORT", Integer.toString(frontendPort));
        builder.environment().put("NOTES_PASSWORD", password);
        builder.environment().put("NOTES_SETUP", setup);
        builder.environment().put("MERGE_OUTPUT", output.toString());
        if ("1".equals(System.getenv("IT_ONLY_CONFLICT_REPORT")) || "1".equals(System.getenv("IT_M2_FINAL"))) builder.environment().put("CHECK_CONFLICT_REPORT", "1");
        builder.environment().put("PYTHONIOENCODING", "utf-8");
        Process process = builder.start();
        boolean finished = process.waitFor(5, TimeUnit.MINUTES);
        if (!finished) process.destroyForcibly();
        assertThat(finished).as("Initial merge verification timed out").isTrue();
        assertThat(process.exitValue()).as(Files.readString(log)).isZero();
        assertThat(Files.readString(log)).contains("PASS: initial-merge");
    }

    private void conflictStatusBrowser(ConfigurableApplicationContext context) throws Exception {
        int port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
        Path output = Path.of("../frontend/test-results/initial-merge-" + run).toAbsolutePath().normalize();
        Path log = output.resolve("web-conflicts.log");
        var builder = new ProcessBuilder("node", "scripts/check-conflict-status.mjs")
                .directory(Path.of("../frontend").toFile()).redirectErrorStream(true).redirectOutput(log.toFile());
        builder.environment().put("NOTES_BACKEND", "http://127.0.0.1:" + port);
        builder.environment().put("NOTES_FRONTEND_PORT", Integer.toString(frontendPort));
        builder.environment().put("NOTES_PASSWORD", password);
        builder.environment().put("CONFLICT_OUTPUT", output.toString());
        var process = builder.start();
        boolean finished = process.waitFor(90, TimeUnit.SECONDS);
        if (!finished) process.destroyForcibly();
        assertThat(finished).as("Conflict status browser timed out").isTrue();
        assertThat(process.exitValue()).as(Files.readString(log)).isZero();
        assertThat(Files.readString(log)).contains("PASS: web-conflicts");
    }

    private void packagedDesktop(ConfigurableApplicationContext context, boolean initialize) throws Exception {
        int port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
        Path output = Path.of("../frontend/test-results/packaged-m2-" + run).toAbsolutePath().normalize();
        Files.createDirectories(output);
        Path log = output.resolve("verification.log");
        var builder = new ProcessBuilder("python", "verification/check_packaged_m2.py")
                .directory(Path.of("../sync-client").toFile()).redirectErrorStream(true).redirectOutput(log.toFile());
        builder.environment().put("NOTES_BACKEND", "http://127.0.0.1:" + port);
        builder.environment().put("NOTES_FRONTEND_PORT", Integer.toString(frontendPort));
        builder.environment().put("NOTES_PASSWORD", password);
        builder.environment().put("NOTES_SETUP", setup);
        builder.environment().put("PACKAGED_INITIALIZE", initialize ? "1" : "0");
        builder.environment().put("PACKAGED_OUTPUT", output.toString());
        builder.environment().put("PYTHONIOENCODING", "utf-8");
        Process process = builder.start();
        boolean finished = process.waitFor(4, TimeUnit.MINUTES);
        if (!finished) process.destroyForcibly();
        assertThat(finished).as("Frozen M2 GUI timed out").isTrue();
        assertThat(process.exitValue()).as(Files.readString(log)).isZero();
        assertThat(Files.readString(log)).contains("PASS: packaged-m2");
    }

    private void fileRenames(ConfigurableApplicationContext context, boolean initialize) throws Exception {
        int port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
        Path output = Path.of("../frontend/test-results/renames-" + run).toAbsolutePath().normalize();
        Files.createDirectories(output);
        Path log = output.resolve("verification.log");
        var builder = new ProcessBuilder("python", "verification/check_file_renames.py", initialize ? "initialize" : "existing")
                .directory(Path.of("../sync-client").toFile()).redirectErrorStream(true).redirectOutput(log.toFile());
        builder.environment().put("NOTES_BACKEND", "http://127.0.0.1:" + port);
        builder.environment().put("NOTES_FRONTEND_PORT", Integer.toString(frontendPort));
        builder.environment().put("NOTES_PASSWORD", password);
        builder.environment().put("NOTES_SETUP", setup);
        builder.environment().put("RENAME_OUTPUT", output.toString());
        Process process = builder.start();
        boolean finished = process.waitFor(3, TimeUnit.MINUTES);
        if (!finished) process.destroyForcibly();
        assertThat(finished).as("File rename verification timed out").isTrue();
        assertThat(process.exitValue()).as(Files.readString(log)).isZero();
        assertThat(Files.readString(log)).contains("PASS: file-renames");
    }
}
