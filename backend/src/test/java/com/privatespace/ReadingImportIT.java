package com.privatespace;

import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;
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

/** Uses migrated course content, actual HTTP/Chrome and MySQL, including a backend restart. */
class ReadingImportIT {
    @TempDir Path directory;
    private final String setupToken = UUID.randomUUID().toString();
    private final String password = UUID.randomUUID() + "!aB9";
    private final Path output = Path.of("../frontend/test-results/reading-import-" + UUID.randomUUID()).toAbsolutePath().normalize();
    private int frontendPort;

    @Test
    void importsManualAndRealRemoteArticlesAndKeepsThemAcrossRestart() throws Exception {
        String url = System.getenv("IT_DB_URL");
        if (url == null || !url.matches("jdbc:mysql://[^/]+/private_space_it(?:\\?.*)?")) {
            throw new IllegalStateException("ReadingImportIT requires isolated private_space_it");
        }
        try (var socket = new ServerSocket(0)) { frontendPort = socket.getLocalPort(); }
        Files.createDirectories(output);
        try (var context = start()) {
            var database = context.getBean(JdbcTemplate.class);
            var sourceService = context.getBean(com.privatespace.modules.english.service.ReadingSourceService.class);
            // Persist a temporary rate-limit state in this isolated DB; the real worker must not fetch.
            database.update("UPDATE english_reading_source SET retry_after_at=UTC_TIMESTAMP()+INTERVAL 1 MINUTE,last_error='test rate limit' WHERE id='nasa'");
            sourceService.sync();
            assertThat(sourceService.status().running()).isFalse();
            assertThat(sourceService.status().lastAttemptAt()).isNull();
            database.update("UPDATE english_reading_source SET retry_after_at=NULL,last_error=NULL WHERE id='nasa'");
            browser(context, "play");
            var jdbc = context.getBean(JdbcTemplate.class);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM english_course WHERE origin_kind='nasa'", Integer.class)).isGreaterThan(0);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM english_course WHERE origin_kind='manual'", Integer.class)).isEqualTo(2);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM english_batch", Integer.class)).isZero();
            var source = context.getBean(com.privatespace.modules.english.service.ReadingSourceService.class);
            source.configure(new com.privatespace.modules.english.dto.ReadingDtos.Configure(source.status().revision(), true));
            // Shift only this isolated DB's attempt time to exercise the actual scheduled selector.
            jdbc.update("UPDATE english_reading_source SET last_attempt_at=UTC_TIMESTAMP()-INTERVAL 7 HOUR WHERE id='nasa'");
            context.getBean(com.privatespace.modules.english.service.impl.ReadingSourceServiceImpl.class).scheduled();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(45);
            while (source.status().running() && System.nanoTime() < deadline) Thread.sleep(100);
            assertThat(source.status().running()).isFalse();
            assertThat(source.status().error()).isNull();
            assertThat(source.status().lastSuccessAt()).isNotNull();
            assertThat(java.time.OffsetDateTime.parse(source.status().lastAttemptAt()))
                    .isAfter(java.time.OffsetDateTime.now().minusMinutes(1));
            source.configure(new com.privatespace.modules.english.dto.ReadingDtos.Configure(source.status().revision(), false));
        }
        try (var context = start()) { browser(context, "restart"); }
    }

    private ConfigurableApplicationContext start() throws Exception {
        var properties = new HashMap<String, Object>();
        properties.put("spring.datasource.url", System.getenv("IT_DB_URL"));
        properties.put("spring.datasource.username", System.getenv("IT_DB_USERNAME"));
        properties.put("spring.datasource.password", System.getenv("IT_DB_PASSWORD"));
        properties.put("private-space.storage.path", Files.createDirectories(directory.resolve("objects")).toString());
        properties.put("private-space.allowed-origins", "http://127.0.0.1:" + frontendPort);
        properties.put("private-space.setup-token", setupToken);
        properties.put("private-space.office.enabled", "false");
        properties.put("private-space.retention.enabled", "false");
        properties.put("private-space.vault-retention.enabled", "false");
        properties.put("server.port", "0");
        return new SpringApplicationBuilder(PrivateSpaceApplication.class).initializers(context ->
                context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("reading-import-it", properties))).run();
    }

    private void browser(ConfigurableApplicationContext context, String phase) throws Exception {
        int port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
        var builder = new ProcessBuilder("node", "scripts/run-reading-import.mjs", phase)
                .directory(Path.of("../frontend").toFile()).inheritIO();
        builder.environment().put("READING_BACKEND", "http://127.0.0.1:" + port);
        builder.environment().put("READING_FRONTEND_PORT", Integer.toString(frontendPort));
        builder.environment().put("READING_OUTPUT", output.toString());
        builder.environment().put("READING_SETUP_TOKEN", setupToken);
        builder.environment().put("READING_PASSWORD", password);
        Process process = builder.start();
        if (!process.waitFor(180, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new IllegalStateException("Course browser verification timed out: " + output);
        }
        assertThat(process.exitValue()).as("Course browser %s; artifacts %s", phase, output).isZero();
    }
}
