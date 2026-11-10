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

/** Focused real HTTP, browser, MySQL and restart verification; no substituted transport or storage. */
class WordGameIT {
    @TempDir Path directory;
    private final String setupToken = UUID.randomUUID().toString();
    private final String password = UUID.randomUUID() + "!aB9";
    private final Path output = Path.of("../frontend/test-results/word-game-" + UUID.randomUUID()).toAbsolutePath().normalize();
    private int frontendPort;

    @Test
    void practicesPersistedPushWordsAndKeepsGradesAcrossRetriesAndRestart() throws Exception {
        String url = System.getenv("IT_DB_URL");
        if (url == null || !url.matches("jdbc:mysql://[^/]+/private_space_it(?:\\?.*)?")) {
            throw new IllegalStateException("WordGameIT requires the isolated private_space_it database");
        }
        try (var socket = new ServerSocket(0)) { frontendPort = socket.getLocalPort(); }
        Files.createDirectories(output);
        try (var context = start()) {
            browser(context, "play");
            var jdbc = context.getBean(JdbcTemplate.class);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM english_word_game", Integer.class)).isGreaterThanOrEqualTo(3);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM english_word_game WHERE revision>0 AND JSON_EXTRACT(payload,'$.attempts')>0", Integer.class)).isGreaterThanOrEqualTo(3);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM english_batch", Integer.class)).isEqualTo(1);
            // Earlier V20 JSON has neither mode nor the spelling answer field.
            assertThat(jdbc.update("UPDATE english_word_game SET payload=JSON_REMOVE(payload,'$.mode','$.lastOperation.answer.spelling') WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.mode'))='matching'")).isGreaterThan(0);
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
                context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("word-game-it", properties))).run();
    }

    private void browser(ConfigurableApplicationContext context, String phase) throws Exception {
        int port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
        var builder = new ProcessBuilder("node", "scripts/run-word-game.mjs", phase)
                .directory(Path.of("../frontend").toFile()).inheritIO();
        builder.environment().put("WORD_GAME_BACKEND", "http://127.0.0.1:" + port);
        builder.environment().put("WORD_GAME_FRONTEND_PORT", Integer.toString(frontendPort));
        builder.environment().put("WORD_GAME_OUTPUT", output.toString());
        builder.environment().put("WORD_GAME_SETUP_TOKEN", setupToken);
        builder.environment().put("WORD_GAME_PASSWORD", password);
        Process process = builder.start();
        if (!process.waitFor(120, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new IllegalStateException("Word game browser verification timed out: " + output);
        }
        assertThat(process.exitValue()).as("Word game browser phase %s; artifacts %s", phase, output).isZero();
    }
}
