package com.privatespace;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;

import javax.sql.DataSource;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/** Opt-in integration checks against a dedicated MySQL 8.4 database and a real HTTP server. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RuntimeIT {

    @TempDir
    static Path storage;

    @Autowired
    DataSource dataSource;

    @Autowired
    Flyway flyway;

    @LocalServerPort
    int port;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        String url = System.getenv("IT_DB_URL");
        if (url == null || !url.matches("jdbc:mysql://[^/]+/private_space_it(?:\\?.*)?")) {
            throw new IllegalStateException("IT_DB_URL must target the dedicated private_space_it database");
        }
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username", () -> System.getenv("IT_DB_USERNAME"));
        registry.add("spring.datasource.password", () -> System.getenv("IT_DB_PASSWORD"));
        registry.add("private-space.storage.path", () -> storage.toString());
        registry.add("management.health.diskspace.path", () -> storage.toString());
    }

    @Test
    void startsHttpWithMigratedMysqlAndPrivateVolume() throws Exception {
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("5");
        assertThat(flyway.info().pending()).isEmpty();
        try (var connection = dataSource.getConnection();
             var query = connection.createStatement();
             var result = query.executeQuery("SELECT VERSION()")) {
            assertThat(result.next()).isTrue();
            assertThat(result.getString(1)).startsWith("8.4.");
        }
        var request = HttpRequest.newBuilder(URI.create(
                "http://127.0.0.1:" + port + "/api/system/health/readiness"))
                .timeout(Duration.ofSeconds(10)).build();
        var response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).isEqualTo("{\"status\":\"UP\"}");
    }

    @Test
    void commitsAndRollsBackUtf8ContentAgainstRealMysql() throws Exception {
        // Only a random test-owned table in the explicitly validated integration database is removed.
        String table = "it_probe_" + UUID.randomUUID().toString().replace("-", "");
        String content = "---\r\ntitle: 中文测试\r\n---\r\n# 笔记 📝\r\n![图片](assets/图.png)\r\n[[双链]]\r\n";
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) {
            statement.execute("CREATE TABLE " + table + " (id INT PRIMARY KEY, content LONGTEXT NOT NULL) CHARACTER SET utf8mb4");
        }
        try {
            try (var connection = dataSource.getConnection()) {
                connection.setAutoCommit(false);
                try (var insert = connection.prepareStatement("INSERT INTO " + table + " VALUES (?, ?)")) {
                    insert.setInt(1, 1);
                    insert.setString(2, content);
                    insert.executeUpdate();
                }
                connection.commit();
                try (var update = connection.prepareStatement("UPDATE " + table + " SET content = ? WHERE id = 1")) {
                    update.setString(1, "rolled back");
                    update.executeUpdate();
                }
                connection.rollback();
            }
            try (var connection = dataSource.getConnection();
                 var statement = connection.createStatement();
                 var result = statement.executeQuery("SELECT content FROM " + table + " WHERE id = 1")) {
                assertThat(result.next()).isTrue();
                assertThat(result.getString(1).getBytes(StandardCharsets.UTF_8))
                        .isEqualTo(content.getBytes(StandardCharsets.UTF_8));
            }
            Path localFile = storage.resolve("中文目录/笔记.md");
            Files.createDirectories(localFile.getParent());
            Files.write(localFile, content.getBytes(StandardCharsets.UTF_8));
            assertThat(Files.readAllBytes(localFile)).isEqualTo(content.getBytes(StandardCharsets.UTF_8));
        } finally {
            try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) {
                statement.execute("DROP TABLE " + table);
            }
        }
    }
}
