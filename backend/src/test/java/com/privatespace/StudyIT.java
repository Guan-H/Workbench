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
class StudyIT {
    @TempDir Path directory;
    private final String setupToken = UUID.randomUUID().toString();
    private final String password = UUID.randomUUID() + "!aB9";
    private final Path output = Path.of("../frontend/test-results/study-" + UUID.randomUUID()).toAbsolutePath().normalize();
    private int frontendPort;

    @Test
    void keepsBilingualContentPlansDraftsAndReviewsAcrossRestart() throws Exception {
        String url = System.getenv("IT_DB_URL");
        if (url == null || !url.matches("jdbc:mysql://[^/]+/private_space_it(?:\\?.*)?")) {
            throw new IllegalStateException("StudyIT requires the isolated private_space_it database");
        }
        try (var socket = new ServerSocket(0)) { frontendPort = socket.getLocalPort(); }
        Files.createDirectories(output);
        try (var context = start()) {
            browser(context, "play");
            var jdbc = context.getBean(JdbcTemplate.class);
            var json=context.getBean(tools.jackson.databind.ObjectMapper.class);
            var legacy=json.readTree(Files.readString(output.resolve("result.json"))).get("legacy");
            String oldFormatHash=com.privatespace.modules.english.util.StudyIdentity.hash(json.writeValueAsString(legacy));
            assertThat(jdbc.queryForObject("SELECT request_hash FROM english_batch WHERE request_id='study-old'",String.class)).isEqualTo(oldFormatHash);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM english_study_plan",Integer.class)).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM english_study_progress WHERE mistakes>0",Integer.class)).isGreaterThan(0);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM english_study_task WHERE submitted=TRUE AND completed=TRUE",Integer.class)).isGreaterThanOrEqualTo(2);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM english_study_source",Integer.class)).isGreaterThan(jdbc.queryForObject("SELECT COUNT(*) FROM english_study_item",Integer.class));

        }
        try (var context = start()) {
            browser(context,"restart");
            var jdbc=context.getBean(JdbcTemplate.class);
            var progress=context.getBean(com.privatespace.modules.english.service.StudyProgressService.class);
            var today=com.privatespace.modules.english.util.StudyDates.today();
            String item=jdbc.queryForObject("SELECT id FROM english_study_item WHERE kind='word' ORDER BY id LIMIT 1",String.class);
            jdbc.update("INSERT INTO english_study_progress(item_id,mode,stage,last_date,next_date) VALUES(?,'matching',1,?,?) ON DUPLICATE KEY UPDATE stage=1,last_date=VALUES(last_date),wrong_date=NULL,next_date=VALUES(next_date)",item,today.minusDays(1),today);
            progress.record(item,"matching",true);
            assertThat(jdbc.queryForObject("SELECT stage FROM english_study_progress WHERE item_id=? AND mode='matching'",Integer.class,item)).isEqualTo(2);
            assertThat(jdbc.queryForObject("SELECT next_date FROM english_study_progress WHERE item_id=? AND mode='matching'",java.time.LocalDate.class,item)).isEqualTo(today.plusDays(3));
            progress.record(item,"matching",true);
            assertThat(jdbc.queryForObject("SELECT stage FROM english_study_progress WHERE item_id=? AND mode='matching'",Integer.class,item)).isEqualTo(2);
            progress.record(item,"matching",false);progress.record(item,"matching",true);
            assertThat(jdbc.queryForObject("SELECT stage FROM english_study_progress WHERE item_id=? AND mode='matching'",Integer.class,item)).isZero();
            // Test-only date shift exercises the real next-plan selector without waiting a day.
            jdbc.update("UPDATE english_study_plan SET learning_date=?",today.minusDays(1));
            jdbc.update("UPDATE english_study_progress SET next_date=?",today);
            browser(context,"review");
        }
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
                context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("study-it", properties))).run();
    }

    private void browser(ConfigurableApplicationContext context, String phase) throws Exception {
        int port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
        var builder = new ProcessBuilder("node", "scripts/run-study.mjs", phase)
                .directory(Path.of("../frontend").toFile()).inheritIO();
        builder.environment().put("WORD_GAME_BACKEND", "http://127.0.0.1:" + port);
        builder.environment().put("WORD_GAME_FRONTEND_PORT", Integer.toString(frontendPort));
        builder.environment().put("WORD_GAME_OUTPUT", output.toString());
        builder.environment().put("WORD_GAME_SETUP_TOKEN", setupToken);
        builder.environment().put("WORD_GAME_PASSWORD", password);
        Process process = builder.start();
        if (!process.waitFor(180, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new IllegalStateException("Word game browser verification timed out: " + output);
        }
        assertThat(process.exitValue()).as("Word game browser phase %s; artifacts %s", phase, output).isZero();
    }
}
