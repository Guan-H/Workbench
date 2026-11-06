package com.privatespace;

import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.dao.DataAccessException;
import com.privatespace.modules.vault.dto.ChangeVaultMasterPasswordRequest;
import com.privatespace.modules.vault.dto.UpdateVaultRequest;
import com.privatespace.modules.vault.service.VaultService;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Real migration, authenticated browser requests and restart persistence in an isolated database. */
class AuthSessionsIT {
    @TempDir
    Path directory;
    private final String run = UUID.randomUUID().toString();
    private final String password = UUID.randomUUID() + "!aB9";
    private final String legacyToken = randomToken();
    private int frontendPort;

    @Test
    void managesRealSessionsWithoutExposingCredentialsOrRevokingCurrentLogin() throws Exception {
        String url = System.getenv("IT_DB_URL");
        if (url == null || !url.matches("jdbc:mysql://[^/]+/private_space_it(?:\\?.*)?")) {
            throw new IllegalStateException("Account verification requires private_space_it");
        }
        try (var socket = new ServerSocket(0)) { frontendPort = socket.getLocalPort(); }
        var source = new DriverManagerDataSource(url, System.getenv("IT_DB_USERNAME"), System.getenv("IT_DB_PASSWORD"));
        var jdbc = new JdbcTemplate(source);
        Flyway.configure().dataSource(source).locations("filesystem:../database/migrations").target("10").load().migrate();
        jdbc.update("INSERT INTO account (id, username, password_hash) VALUES (1, ?, ?)",
                "sessions-it", new BCryptPasswordEncoder(12).encode(password));
        jdbc.update("INSERT INTO web_session (token_hash, expires_at) VALUES (?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 12 HOUR))", hash(legacyToken));

        String legacyId;
        boolean checkMaster = "1".equals(System.getenv("CHECK_VAULT_MASTER"));
        boolean checkSecureNotes = "1".equals(System.getenv("CHECK_VAULT_SECURE_NOTES"));
        if ("1".equals(System.getenv("CHECK_VAULT_DRAFT_BOX")) && !checkSecureNotes) {
            throw new IllegalStateException("Draft-box checks require the genuine secure-note flow");
        }
        if ("1".equals(System.getenv("CHECK_VAULT_CUSTOM_AVATARS")) && !"1".equals(System.getenv("CHECK_VAULT_AVATARS"))) {
            throw new IllegalStateException("Custom-avatar checks require the real avatar flow");
        }
        if ("1".equals(System.getenv("CHECK_VAULT_AVATARS")) && !checkSecureNotes) {
            throw new IllegalStateException("Avatar checks require the genuine secure-note flow");
        }
        if ("1".equals(System.getenv("CHECK_VAULT_TRASH")) && !checkSecureNotes) {
            throw new IllegalStateException("Trash checks require the genuine secure-note flow");
        }
        if (checkSecureNotes && (!"1".equals(System.getenv("CHECK_VAULT_FOUNDATION")) || checkMaster)) {
            throw new IllegalStateException("Secure-note checks use the foundation flow separately from master-password checks");
        }
        if (checkMaster && !"1".equals(System.getenv("CHECK_VAULT_FOUNDATION"))) {
            throw new IllegalStateException("Master-password checks require the real vault foundation flow");
        }
        if ("1".equals(System.getenv("CHECK_VAULT_ENTRIES")) && !checkMaster) {
            throw new IllegalStateException("Entry verification requires the genuine master-password flow first");
        }
        // Keep a genuine V12 vault across the V13 migration before exercising rewrapping.
        try (var context = start(checkMaster ? "12" : null)) {
            legacyId = jdbc.queryForObject("SELECT id FROM web_session WHERE token_hash = ?", String.class, hash(legacyToken));
            assertThat(UUID.fromString(legacyId).toString()).isEqualTo(legacyId);
            browser(context, "write");
            if ("1".equals(System.getenv("CHECK_VAULT_FOUNDATION"))) {
                assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM vault_snapshot", Integer.class)).isEqualTo(1);
                assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM vault_snapshot_history", Integer.class)).isEqualTo(1);
                String envelope = jdbc.queryForObject("SELECT envelope FROM vault_snapshot", String.class);
                assertThat(envelope).contains("private-space-vault").doesNotContain("M3_FAKE_MASTER", "M3_FAKE_PLAINTEXT_FIELD");
            }
            var report = new ObjectMapper().readTree(Files.readString(output().resolve("state.json")));
            assertThat(report.get("legacyId").asText()).isEqualTo(legacyId);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM web_session", Integer.class)).isEqualTo(13);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM web_session WHERE id IS NULL", Integer.class)).isZero();
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM web_session WHERE id = ?", Integer.class, report.get("revokedId").asText())).isZero();
            // Fault injection expires one genuine session using the persisted server clock.
            jdbc.update("UPDATE web_session SET expires_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 HOUR) WHERE id = ?", report.get("expiredId").asText());
        }
        if (checkSecureNotes) {
            try (var context = start()) {
                browser(context, "secure-notes");
                var report = new ObjectMapper().readTree(Files.readString(output().resolve("vault-secure-note-report.json")));
                long version = Long.parseLong(report.get("version").asText());
                assertThat(jdbc.queryForObject("SELECT version FROM vault_snapshot", Long.class)).isEqualTo(version);
                assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM vault_snapshot_history", Long.class)).isEqualTo(version);
                assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM note_file", Long.class)).isZero();
                assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM file_object", Long.class)).isZero();
                assertThat(jdbc.queryForObject("SELECT envelope FROM vault_snapshot", String.class)).doesNotContain("M3_SECURE_", "M3_FAKE_MASTER", "data:image/png;base64,", "M3_CUSTOM_AVATAR_ORIGINAL");
                assertThat(jdbc.queryForList("SELECT envelope FROM vault_snapshot_history", String.class))
                        .allSatisfy(envelope -> assertThat(envelope).doesNotContain("M3_SECURE_", "M3_FAKE_MASTER", "data:image/png;base64,", "M3_CUSTOM_AVATAR_ORIGINAL"));
            }
        }
        if (checkMaster) {
            try (var context = start()) {
                assertThat(jdbc.queryForObject("SELECT version FROM vault_snapshot", Long.class)).isEqualTo(1L);
                String loginHash = jdbc.queryForObject("SELECT password_hash FROM account WHERE id=1", String.class);
                browser(context, "master");
                assertThat(jdbc.queryForObject("SELECT version FROM vault_snapshot", Long.class)).isEqualTo(3L);
                assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM vault_snapshot_history", Integer.class)).isEqualTo(3);
                assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM vault_snapshot_history WHERE operation_id IS NOT NULL AND base_version=version-1", Integer.class)).isEqualTo(2);
                assertThat(jdbc.queryForObject("SELECT password_hash FROM account WHERE id=1", String.class)).isEqualTo(loginHash);
                checkVaultRollback(context, jdbc, "vault-rollback-candidate.json", false);
                if ("1".equals(System.getenv("CHECK_VAULT_ENTRIES"))) {
                    browser(context, "entries");
                    var entryReport = new ObjectMapper().readTree(Files.readString(output().resolve("vault-entry-report.json")));
                    long version = Long.parseLong(entryReport.get("version").asText());
                    assertThat(jdbc.queryForObject("SELECT version FROM vault_snapshot", Long.class)).isEqualTo(version);
                    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM vault_snapshot_history", Long.class)).isEqualTo(version);
                    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM vault_snapshot_history WHERE operation_kind='content'", Long.class)).isGreaterThan(0);
                    assertThat(jdbc.queryForObject("SELECT envelope FROM vault_snapshot", String.class)).doesNotContain("M3_ENTRY_", "M3_FAKE_MASTER");
                    checkVaultRollback(context, jdbc, "vault-entry-rollback-candidate.json", true);
                }
            }
        }
        // Recreate the real application context again so a changed wrapper must survive restart.
        try (var context = start()) {
            browser(context, "restore");
            if (checkSecureNotes) browser(context, "secure-notes-restore");
            assertThat(jdbc.queryForObject("SELECT id FROM web_session WHERE token_hash = ?", String.class, hash(legacyToken))).isEqualTo(legacyId);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM web_session WHERE expires_at > UTC_TIMESTAMP(6)", Integer.class)).isEqualTo(12);
        }
    }

    private ConfigurableApplicationContext start() throws Exception {
        return start(null);
    }

    private ConfigurableApplicationContext start(String target) throws Exception {
        var properties = new HashMap<String, Object>();
        properties.put("spring.datasource.url", System.getenv("IT_DB_URL"));
        properties.put("spring.datasource.username", System.getenv("IT_DB_USERNAME"));
        properties.put("spring.datasource.password", System.getenv("IT_DB_PASSWORD"));
        properties.put("private-space.storage.path", Files.createDirectories(directory.resolve("objects")).toString());
        properties.put("private-space.allowed-origins", "http://127.0.0.1:" + frontendPort);
        properties.put("private-space.setup-token", UUID.randomUUID() + "-" + UUID.randomUUID());
        properties.put("server.port", "0");
        if (target != null) properties.put("spring.flyway.target", target);
        return new SpringApplicationBuilder(PrivateSpaceApplication.class).initializers(context ->
                context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("sessions-it", properties))).run();
    }

    private Path output() { return Path.of("../frontend/test-results/sessions-" + run).toAbsolutePath().normalize(); }

    private void checkVaultRollback(ConfigurableApplicationContext context, JdbcTemplate jdbc, String file, boolean content) throws Exception {
        var candidate = new ObjectMapper().readTree(Files.readString(output().resolve(file)));
        long version = Long.parseLong(candidate.get("baseVersion").asText());
        long history = jdbc.queryForObject("SELECT COUNT(*) FROM vault_snapshot_history", Long.class);
        String before = jdbc.queryForObject("SELECT envelope FROM vault_snapshot", String.class);
        // Fault injection rejects the actual history INSERT after the actual current snapshot UPDATE.
        jdbc.execute("ALTER TABLE vault_snapshot_history ADD CONSTRAINT vault_history_failure_test CHECK (version <= " + version + ")");
        try {
            assertThatThrownBy(() -> {
                var service = context.getBean(VaultService.class);
                if (content) service.save(new UpdateVaultRequest(candidate.get("baseVersion").asText(), candidate.get("envelope")), candidate.get("operation").asText());
                else service.changeMasterPassword(new ChangeVaultMasterPasswordRequest(candidate.get("baseVersion").asText(), candidate.get("envelope")), candidate.get("operation").asText());
            })
                    .isInstanceOf(DataAccessException.class);
            assertThat(jdbc.queryForObject("SELECT envelope FROM vault_snapshot", String.class)).isEqualTo(before);
            assertThat(jdbc.queryForObject("SELECT version FROM vault_snapshot", Long.class)).isEqualTo(version);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM vault_snapshot_history", Long.class)).isEqualTo(history);
            assertThat(before).doesNotContain("M3_FAKE_MASTER");
        } finally {
            jdbc.execute("ALTER TABLE vault_snapshot_history DROP CHECK vault_history_failure_test");
        }
    }

    private void browser(ConfigurableApplicationContext context, String phase) throws Exception {
        Files.createDirectories(output());
        Path log = output().resolve(phase + ".log");
        int port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
        String script = phase.startsWith("secure-notes") ? "scripts/run-vault-secure-notes.mjs" : "master".equals(phase) ? "scripts/run-vault-master-password.mjs"
                : "entries".equals(phase) ? "scripts/run-vault-entries.mjs" : "scripts/check-account-sessions.mjs";
        var builder = new ProcessBuilder("node", script, phase)
                .directory(Path.of("../frontend").toFile()).redirectErrorStream(true).redirectOutput(log.toFile());
        builder.environment().put("SESSIONS_BACKEND", "http://127.0.0.1:" + port);
        builder.environment().put("SESSIONS_FRONTEND_PORT", Integer.toString(frontendPort));
        builder.environment().put("SESSIONS_OUTPUT", output().toString());
        builder.environment().put("SESSIONS_PASSWORD", password);
        builder.environment().put("SESSIONS_LEGACY_TOKEN", legacyToken);
        Process process = builder.start();
        boolean finished = process.waitFor(Duration.ofSeconds(120).toSeconds(), TimeUnit.SECONDS);
        if (!finished) process.destroyForcibly();
        assertThat(finished).as("Session browser timeout").isTrue();
        assertThat(process.exitValue()).as(Files.readString(log)).isZero();
        assertThat(Files.readString(log)).contains("PASS: account-sessions-" + phase);
    }

    private static String randomToken() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String hash(String value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    }
}
