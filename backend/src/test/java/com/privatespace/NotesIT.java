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
            browser(context, "write");
            if ("1".equals(System.getenv("IT_INCLUDE_SYNC"))) sync(context, "write");
            verifyMoveRollback(context);
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
