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
class CourseIT {
    @TempDir Path directory;
    private final String setupToken = UUID.randomUUID().toString();
    private final String password = UUID.randomUUID() + "!aB9";
    private final Path output = Path.of("../frontend/test-results/courses-" + UUID.randomUUID()).toAbsolutePath().normalize();
    private int frontendPort;

    @Test
    void persistsCourseAnswersReadingPositionAndReviewAcrossRestart() throws Exception {
        String url = System.getenv("IT_DB_URL");
        if (url == null || !url.matches("jdbc:mysql://[^/]+/private_space_it(?:\\?.*)?")) {
            throw new IllegalStateException("CourseIT requires isolated private_space_it");
        }
        try (var socket = new ServerSocket(0)) { frontendPort = socket.getLocalPort(); }
        Files.createDirectories(output);
        try (var context = start()) {
            // Actual persisted V25 state has no favorite field; it must stay readable after V26.
            context.getBean(JdbcTemplate.class).update("INSERT INTO english_course_progress(course_id,revision,payload) VALUES('word-forms',7,?)",
                    "{\"position\":\"sentence-1\",\"answers\":{},\"marked\":[],\"wrong\":[],\"completed\":true}");
            browser(context, "play");
            var jdbc = context.getBean(JdbcTemplate.class);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM english_course", Integer.class)).isEqualTo(5);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM english_course_operation", Integer.class)).isGreaterThan(5);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM english_batch", Integer.class)).isZero();
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
                context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("course-it", properties))).run();
    }

    private void browser(ConfigurableApplicationContext context, String phase) throws Exception {
        int port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
        var builder = new ProcessBuilder("node", "scripts/run-courses.mjs", phase)
                .directory(Path.of("../frontend").toFile()).inheritIO();
        builder.environment().put("COURSE_BACKEND", "http://127.0.0.1:" + port);
        builder.environment().put("COURSE_FRONTEND_PORT", Integer.toString(frontendPort));
        builder.environment().put("COURSE_OUTPUT", output.toString());
        builder.environment().put("COURSE_SETUP_TOKEN", setupToken);
        builder.environment().put("COURSE_PASSWORD", password);
        Process process = builder.start();
        if (!process.waitFor(180, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new IllegalStateException("Course browser verification timed out: " + output);
        }
        assertThat(process.exitValue()).as("Course browser %s; artifacts %s", phase, output).isZero();
    }
}
