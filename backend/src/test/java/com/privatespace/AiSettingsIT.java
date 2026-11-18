package com.privatespace;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class AiSettingsIT {
    @TempDir Path directory;
    private final ObjectMapper json = new ObjectMapper();
    private final String setupToken = UUID.randomUUID().toString();
    private final String password = UUID.randomUUID() + "!aB9";
    private final String fixtureKey = "fixture-" + UUID.randomUUID();
    private final List<Map<String, String>> models = List.of(Map.of("modelId", "deepseek-flash", "name", "Flash"));

    @Test
    void protectsCredentialsAcrossSettingsEditsAndServerRestart() throws Exception {
        String key = encryptionKey();
        byte[] original;
        try (var context = start(key)) {
            var http = new Http(context);
            assertThat(http.call("GET", "/ai/settings", null).statusCode()).isEqualTo(401);
            var credentials = Map.of("username", "ai-test", "password", password, "setupToken", setupToken);
            assertThat(http.call("POST", "/auth/initialize", credentials).statusCode()).isEqualTo(200);
            var saved = http.call("PUT", "/ai/settings",
                    Map.of("revision", 0, "providerName", "DeepSeek", "models", models, "apiKey", fixtureKey));
            assertThat(saved.statusCode()).isEqualTo(200);
            assertThat(saved.body()).doesNotContain(fixtureKey, "encryptedKey", "apiKey");
            assertThat(json.readTree(saved.body()).path("keyConfigured").asBoolean()).isTrue();
            original = encryptedKey(context);
            assertThat(new String(original, StandardCharsets.UTF_8)).doesNotContain(fixtureKey);
            var rename = Map.of("revision", 1, "providerName", "DeepSeek Test", "models", models);
            assertThat(http.call("PUT", "/ai/settings", rename).statusCode()).isEqualTo(200);
            assertThat(http.call("PUT", "/ai/settings", rename).statusCode()).isEqualTo(409);
            assertThat(encryptedKey(context)).containsExactly(original);

            String otherKey = "fixture-kimi-" + UUID.randomUUID();
            var other = http.call("PUT", "/ai/settings?provider=kimi",
                    Map.of("revision", 0, "providerName", "Kimi Test", "models", models, "apiKey", otherKey));
            assertThat(other.statusCode()).isEqualTo(200);
            assertThat(other.body()).contains("https://api.moonshot.cn/v1").doesNotContain(otherKey, "encryptedKey");
            var catalog = http.call("GET", "/ai/providers", null);
            assertThat(catalog.statusCode()).isEqualTo(200);
            assertThat(catalog.body()).contains("DeepSeek Test", "Kimi Test", "OpenAI", "OpenRouter", "硅基流动")
                    .doesNotContain(fixtureKey, otherKey);
            assertThat(http.call("GET", "/ai/settings?provider=custom", null).statusCode()).isEqualTo(400);
            assertThat(encryptedKey(context)).containsExactly(original);
            byte[] kimi = context.getBean(JdbcTemplate.class).queryForObject(
                    "SELECT api_key_encrypted FROM ai_provider_settings WHERE provider_id='kimi'", byte[].class);
            assertThat(kimi).isNotNull().isNotEqualTo(original);
            assertThat(new String(kimi, StandardCharsets.UTF_8)).doesNotContain(otherKey);
        }
        try (var context = start(encryptionKey())) {
            var http = new Http(context);
            assertThat(http.call("POST", "/auth/login", Map.of("username", "ai-test", "password", password)).statusCode())
                    .isEqualTo(200);
            var saved = http.call("GET", "/ai/settings", null);
            assertThat(saved.statusCode()).isEqualTo(200);
            assertThat(saved.body()).contains("DeepSeek Test", "deepseek-flash").doesNotContain(fixtureKey);
            for (String path : List.of("/ai/probe", "/ai/probe/stream")) {
                var failure = http.call("POST", path, Map.of("modelId", "deepseek-flash", "text", "Test prompt"));
                assertThat(failure.statusCode()).isEqualTo(503);
                assertThat(failure.body()).contains("AI_KEY_UNAVAILABLE").doesNotContain(fixtureKey);
            }
            assertThat(encryptedKey(context)).containsExactly(original);
            assertThat(http.call("GET", "/ai/settings?provider=kimi", null).body()).contains("Kimi Test");
        }
    }

    private byte[] encryptedKey(ConfigurableApplicationContext context) {
        return context.getBean(JdbcTemplate.class)
                .queryForObject("SELECT api_key_encrypted FROM ai_deepseek_settings WHERE id=1", byte[].class);
    }

    private static String encryptionKey() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }

    private ConfigurableApplicationContext start(String key) throws Exception {
        String url = System.getenv("IT_DB_URL");
        if (url == null || !url.matches("jdbc:mysql://127\\.0\\.0\\.1:\\d+/private_space_it(?:\\?.*)?")) {
            throw new IllegalStateException("AiSettingsIT requires isolated local MySQL");
        }
        var properties = new HashMap<String, Object>();
        properties.put("spring.datasource.url", url);
        properties.put("spring.datasource.username", System.getenv("IT_DB_USERNAME"));
        properties.put("spring.datasource.password", System.getenv("IT_DB_PASSWORD"));
        properties.put("private-space.storage.path", Files.createDirectories(directory.resolve("objects")).toString());
        properties.put("private-space.setup-token", setupToken);
        properties.put("private-space.office.enabled", "false");
        properties.put("private-space.retention.enabled", "false");
        properties.put("private-space.vault-retention.enabled", "false");
        properties.put("private-space.allowed-origins", "http://127.0.0.1:5173");
        properties.put("PRIVATE_SPACE_AI_ENCRYPTION_KEY", key);
        properties.put("server.port", "0");
        return new SpringApplicationBuilder(PrivateSpaceApplication.class).initializers(context ->
                context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("ai-settings-it", properties))).run();
    }

    private final class Http {
        private final String base;
        private final HttpClient client = HttpClient.newHttpClient();
        private final Map<String, String> cookies = new HashMap<>();

        Http(ConfigurableApplicationContext context) {
            base = "http://127.0.0.1:" + ((ServletWebServerApplicationContext) context).getWebServer().getPort() + "/api/v1";
        }

        HttpResponse<String> call(String method, String path, Object body) throws Exception {
            String csrf = null;
            if (body != null) csrf = json.readTree(call("GET", "/auth/csrf", null).body()).path("token").asText();
            var request = HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(10));
            if (!cookies.isEmpty()) request.header("Cookie", String.join("; ", cookies.values()));
            if (body == null) request.GET();
            else request.header("Origin", "http://127.0.0.1:5173").header("X-CSRF-TOKEN", csrf)
                    .header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
            var response = client.send(request.build(), HttpResponse.BodyHandlers.ofString());
            for (String cookie : response.headers().allValues("Set-Cookie")) {
                String pair = cookie.split(";", 2)[0];
                cookies.put(pair.split("=", 2)[0], pair);
            }
            return response;
        }
    }
}
