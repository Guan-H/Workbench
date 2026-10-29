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
        try (var context = start()) {
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
            if ("1".equals(System.getenv("IT_INCLUDE_SYNC"))) sync(context, "write");
            verifyMoveRollback(context);
            verifyDirectoryRecycle(context);
            verifySelectiveRecovery(context);
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
        }
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
        boolean finished = process.waitFor(Duration.ofMinutes(4).toSeconds(), TimeUnit.SECONDS);
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
}
