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

class SharedAppearanceIT {
    @TempDir Path directory;
    private final String setup = UUID.randomUUID().toString();
    private final String password = UUID.randomUUID() + "!aB9";
    private final Path output = Path.of("../frontend/test-results/shared-appearance-" + UUID.randomUUID()).toAbsolutePath().normalize();
    private int frontendPort;
    @Test
    void sharesThemeAcrossSessionsAndRestart() throws Exception {
        String url = System.getenv("IT_DB_URL");
        if (url == null || !url.matches("jdbc:mysql://[^/]+/private_space_it(?:\\?.*)?")) throw new IllegalStateException("Isolated private_space_it required");
        try (var socket = new ServerSocket(0)) { frontendPort = socket.getLocalPort(); }
        Files.createDirectories(output);
        try (var context = start()) {
            browser(context, "write");
            assertThat(context.getBean(JdbcTemplate.class).queryForObject("SELECT version FROM workspace_appearance WHERE id=1", Long.class)).isEqualTo(1L);
        }
        try (var context = start()) { browser(context, "restart"); }
    }
    private ConfigurableApplicationContext start() throws Exception {
        var properties = new HashMap<String,Object>();
        properties.put("spring.datasource.url", System.getenv("IT_DB_URL"));
        properties.put("spring.datasource.username", System.getenv("IT_DB_USERNAME"));
        properties.put("spring.datasource.password", System.getenv("IT_DB_PASSWORD"));
        properties.put("private-space.storage.path", Files.createDirectories(directory.resolve("objects")).toString());
        properties.put("private-space.allowed-origins", "http://127.0.0.1:" + frontendPort);
        properties.put("private-space.setup-token", setup);
        properties.put("private-space.office.enabled", "false");
        properties.put("private-space.retention.enabled", "false");
        properties.put("private-space.vault-retention.enabled", "false");
        properties.put("server.port", "0");
        return new SpringApplicationBuilder(PrivateSpaceApplication.class).initializers(context -> context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("shared-appearance-it", properties))).run();
    }
    private void browser(ConfigurableApplicationContext context, String phase) throws Exception {
        int port = ((ServletWebServerApplicationContext)context).getWebServer().getPort();
        var builder = new ProcessBuilder("node", "scripts/check-shared-appearance.mjs", phase).directory(Path.of("../frontend").toFile()).inheritIO();
        builder.environment().put("FEATURE_BACKEND", "http://127.0.0.1:" + port);
        builder.environment().put("FEATURE_PORT", Integer.toString(frontendPort));
        builder.environment().put("FEATURE_OUTPUT", output.toString());
        builder.environment().put("FEATURE_SETUP", setup);
        builder.environment().put("FEATURE_PASSWORD", password);
        var process = builder.start();
        if (!process.waitFor(240, TimeUnit.SECONDS)) { process.destroyForcibly(); throw new IllegalStateException("Browser verification timed out: " + output); }
        assertThat(process.exitValue()).as("Artifacts %s", output).isZero();
    }
}
