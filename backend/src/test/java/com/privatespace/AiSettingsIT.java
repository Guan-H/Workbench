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
        String initialConversation;
        String secondConnection;
        String customId;
        String customConnection;
        String manualId;
        String manualConnection;
        var manualRequest = Map.of("providerId", "custom", "name", "Manual Gateway",
                "apiKey", fixtureKey, "baseUrl", "https://MANUAL.example.com:443/compatible/v1/");
        String manualAddress = "https://manual.example.com/compatible/v1";
        try (var context = start(key, "https://gateway.example.com/openai/v1")) {
            var http = new Http(context);
            assertThat(http.call("GET", "/ai/settings", null).statusCode()).isEqualTo(401);
            assertThat(http.call("GET", "/ai/default-model", null).statusCode()).isEqualTo(401);
            assertThat(http.call("POST", "/ai/connections", manualRequest).statusCode()).isEqualTo(401);
            var credentials = Map.of("username", "ai-test", "password", password, "setupToken", setupToken);
            assertThat(http.call("POST", "/auth/initialize", credentials).statusCode()).isEqualTo(200);
            assertThat(http.call("GET", "/ai/providers", null).body()).isEqualTo("[]");
            assertThat(http.call("GET", "/ai/provider-presets", null).body())
                    .contains("DeepSeek", "OpenAI", "Kimi", "OpenRouter", "硅基流动");
            var presets = json.readTree(http.call("GET", "/ai/provider-presets", null).body());
            var custom = presets.path(presets.size() - 1);
            assertThat(custom.path("custom").asBoolean()).isTrue();
            assertThat(custom.path("baseUrl").asText()).isEqualTo("https://gateway.example.com/openai/v1");
            customId = custom.path("id").asText();
            assertFailure(http.call("POST", "/ai/connections", Map.of("providerId", "https://unregistered.example.com",
                    "name", "Unregistered", "apiKey", fixtureKey)), 400, "AI_INVALID_INPUT");
            assertFailure(http.call("POST", "/ai/connections", Map.of("providerId", "custom-00000000000000000",
                    "name", "Unregistered", "apiKey", fixtureKey)), 409, "AI_PROVIDER_UNAVAILABLE");
            assertFailure(http.call("POST", "/ai/connections", Map.of("providerId", customId, "name", "Team Gateway",
                    "apiKey", fixtureKey, "baseUrl", "https://unregistered.example.com")), 400, "AI_CUSTOM_URL_NOT_ALLOWED");
            var gateway = http.call("POST", "/ai/connections", Map.of("providerId", customId, "name", "Team Gateway",
                    "apiKey", fixtureKey));
            assertThat(gateway.statusCode()).isEqualTo(200);
            assertThat(gateway.body()).contains("https://gateway.example.com/openai/v1").doesNotContain(fixtureKey);
            customConnection = json.readTree(gateway.body()).path("connectionId").asText();
            assertThat(http.call("PUT", "/ai/settings?provider=" + customId + "&connection=" + customConnection,
                    Map.of("revision", 0, "providerName", "Team Gateway", "models", models)).statusCode()).isEqualTo(200);
            for (String invalid : List.of("http://manual.example.com/v1", "https://127.0.0.1/v1", "https://gateway.internal/v1",
                    "https://manual.example.com/v1?key=secret")) {
                var bad = new HashMap<>(manualRequest);
                bad.put("baseUrl", invalid);
                assertFailure(http.call("POST", "/ai/connections", bad), 400, "AI_CUSTOM_URL_INVALID");
            }
            assertThat(http.call("GET", "/ai/providers", null).body()).doesNotContain("Manual Gateway");
            var manual = http.call("POST", "/ai/connections", manualRequest);
            assertThat(manual.statusCode()).isEqualTo(200);
            var manualSettings = json.readTree(manual.body());
            manualId = manualSettings.path("providerId").asText();
            manualConnection = manualSettings.path("connectionId").asText();
            assertThat(manualId).startsWith("custom-").isNotEqualTo(customId);
            assertThat(manualSettings.path("baseUrl").asText()).isEqualTo(manualAddress);
            assertThat(manual.body()).doesNotContain(fixtureKey, "encryptedKey");
            var modelSave = http.call("PUT", "/ai/settings?provider=" + manualId + "&connection=" + manualConnection,
                    Map.of("revision", 0, "providerName", "Manual Gateway", "models", models,
                            "baseUrl", "https://replacement.example.com/v1"));
            assertThat(modelSave.statusCode()).isEqualTo(200);
            assertThat(modelSave.body()).contains(manualAddress).doesNotContain("replacement.example.com");
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
            assertThat(catalog.body()).contains("DeepSeek Test", "Kimi Test")
                    .doesNotContain("OpenAI", "OpenRouter", "硅基流动")
                    .doesNotContain(fixtureKey, otherKey);
            assertThat(http.call("GET", "/ai/settings?provider=custom", null).statusCode()).isEqualTo(400);
            assertThat(encryptedKey(context)).containsExactly(original);
            byte[] kimi = context.getBean(JdbcTemplate.class).queryForObject(
                    "SELECT api_key_encrypted FROM ai_provider_connection WHERE id='kimi'", byte[].class);
            assertThat(kimi).isNotNull().isNotEqualTo(original);
            assertThat(new String(kimi, StandardCharsets.UTF_8)).doesNotContain(otherKey);
            var empty = http.call("GET", "/ai/default-model", null);
            assertThat(empty.statusCode()).isEqualTo(200);
            assertThat(json.readTree(empty.body()).path("modelId").isNull()).isTrue();
            var unconfigured = Map.of("revision", 0, "providerId", "openai", "modelId", "deepseek-flash");
            assertThat(http.call("PUT", "/ai/default-model", unconfigured).statusCode()).isEqualTo(400);
            var kimiDefault = Map.of("revision", 0, "providerId", "kimi", "modelId", "deepseek-flash");
            assertThat(http.call("PUT", "/ai/default-model", kimiDefault).statusCode()).isEqualTo(200);
            assertThat(http.call("PUT", "/ai/default-model", kimiDefault).statusCode()).isEqualTo(409);
            var created = http.call("POST", "/ai/conversations", Map.of());
            assertThat(created.statusCode()).isEqualTo(200);
            var conversation = json.readTree(created.body());
            initialConversation = conversation.path("id").asText();
            assertThat(conversation.path("providerId").asText()).isEqualTo("kimi");
            assertThat(conversation.path("connectionId").asText()).isEqualTo("kimi");
            assertThat(conversation.path("modelId").asText()).isEqualTo("deepseek-flash");
            var deepSeekDefault = Map.of("revision", 1, "providerId", "deepseek", "modelId", "deepseek-flash");
            assertThat(http.call("PUT", "/ai/default-model", deepSeekDefault).statusCode()).isEqualTo(200);
            var primary = json.readTree(http.call("POST", "/ai/conversations", Map.of()).body());
            assertThat(primary.path("connectionId").asText()).isEqualTo("deepseek");

            var db = context.getBean(JdbcTemplate.class);
            assertFailure(http.call("POST", "/ai/connections", Map.of("providerId", "deepseek", "name", "DeepSeek Work")),
                    400, "AI_KEY_NOT_CONFIGURED");
            assertThat(db.queryForObject("SELECT COUNT(*) FROM ai_provider_connection WHERE provider_name='DeepSeek Work'", Integer.class))
                    .isZero();
            String workKey = "fixture-work-" + UUID.randomUUID();
            var newConnection = Map.of("providerId", "deepseek", "name", "DeepSeek Work", "apiKey", workKey);
            var opened = http.call("POST", "/ai/connections", newConnection);
            assertThat(opened.statusCode()).isEqualTo(200);
            assertThat(opened.body()).contains("\"keyConfigured\":true").doesNotContain(workKey);
            secondConnection = json.readTree(opened.body()).path("connectionId").asText();
            assertThat(secondConnection).isNotBlank().isNotEqualTo("deepseek");
            assertThat(http.call("POST", "/ai/connections", newConnection).statusCode()).isEqualTo(409);
            String workPath = "/ai/settings?provider=deepseek&connection=" + secondConnection;
            var workSave = http.call("PUT", workPath,
                    Map.of("revision", 0, "providerName", "DeepSeek Work", "models", models));
            assertThat(workSave.statusCode()).isEqualTo(200);
            assertThat(workSave.body()).doesNotContain(workKey);
            assertThat(encryptedKey(context)).containsExactly(original);
            assertThat(http.call("GET", "/ai/settings?provider=kimi&connection=" + secondConnection, null)
                    .statusCode()).isEqualTo(404);
            var workDefault = Map.of("revision", 2, "providerId", "deepseek", "connectionId", secondConnection,
                    "modelId", "deepseek-flash");
            assertThat(http.call("PUT", "/ai/default-model", workDefault).statusCode()).isEqualTo(200);
            assertThat(json.readTree(http.call("POST", "/ai/conversations", Map.of()).body()).path("connectionId").asText())
                    .isEqualTo(secondConnection);

            String chatId = primary.path("id").asText();
            String turnId = seedHistory(db, chatId);
            var change = new HashMap<String, Object>(Map.of("id", UUID.randomUUID().toString(), "revision", 1,
                    "modelId", "fixture-not-configured", "text", "New fixture prompt", "providerId", "deepseek",
                    "connectionId", secondConnection, "credentialRevision", 0));
            String chatPath = "/ai/conversations/" + chatId + "/turns";
            assertFailure(http.call("POST", chatPath, change), 409, "AI_HISTORY_CONFIRMATION_REQUIRED");
            assertFailure(http.call("POST", chatPath + "/" + turnId + "/regenerate", change),
                    409, "AI_HISTORY_CONFIRMATION_REQUIRED");
            change.put("confirmedProviderId", "deepseek");
            change.put("confirmedConnectionId", "deepseek");
            assertFailure(http.call("POST", chatPath, change), 409, "AI_HISTORY_CONFIRMATION_REQUIRED");
            change.put("confirmedConnectionId", secondConnection);
            assertFailure(http.call("POST", chatPath, change), 400, "AI_MODEL_NOT_CONFIGURED");
            var customChange = new HashMap<>(change);
            customChange.put("providerId", manualId);
            customChange.put("connectionId", manualConnection);
            assertFailure(http.call("POST", chatPath, customChange), 409, "AI_HISTORY_CONFIRMATION_REQUIRED");
            customChange.put("confirmedConnectionId", manualConnection);
            assertFailure(http.call("POST", chatPath, customChange), 400, "AI_MODEL_NOT_CONFIGURED");
            assertThat(http.call("PUT", workPath, Map.of("revision", 1, "providerName", "DeepSeek Work", "models", models,
                    "apiKey", "fixture-rotated-" + UUID.randomUUID())).statusCode()).isEqualTo(200);
            assertFailure(http.call("POST", chatPath, change), 409, "AI_CONNECTION_CHANGED");
            assertThat(db.queryForObject("SELECT COUNT(*) FROM ai_chat_turn WHERE conversation_id=?", Integer.class, chatId))
                    .isEqualTo(1);
            assertThat(db.queryForObject("SELECT COUNT(*) FROM ai_chat_answer WHERE turn_id=?", Integer.class, turnId))
                    .isEqualTo(1);
        }
        try (var context = start(encryptionKey(), "https://gateway.example.com/other/v1")) {
            var http = new Http(context);
            assertThat(http.call("POST", "/auth/login", Map.of("username", "ai-test", "password", password)).statusCode())
                    .isEqualTo(200);
            var saved = http.call("GET", "/ai/settings", null);
            assertThat(saved.statusCode()).isEqualTo(200);
            assertThat(saved.body()).contains("DeepSeek Test", "deepseek-flash").doesNotContain(fixtureKey);
            assertThat(http.call("GET", "/ai/provider-presets", null).body())
                    .contains("https://gateway.example.com/other/v1").doesNotContain(customId);
            var oldGateway = http.call("GET", "/ai/settings?provider=" + customId + "&connection=" + customConnection, null);
            assertThat(oldGateway.body()).contains("Team Gateway", "\"available\":false").doesNotContain(fixtureKey);
            var manual = http.call("GET", "/ai/settings?provider=" + manualId + "&connection=" + manualConnection, null);
            assertThat(manual.body()).contains(manualAddress, "\"available\":true", "deepseek-flash").doesNotContain(fixtureKey);
            assertFailure(http.call("POST", "/ai/probe", Map.of("providerId", manualId, "connectionId", manualConnection,
                    "modelId", "deepseek-flash", "text", "Fixture text")), 503, "AI_KEY_UNAVAILABLE");
            assertFailure(http.call("POST", "/ai/probe", Map.of("providerId", customId, "connectionId", customConnection,
                    "modelId", "deepseek-flash", "text", "Fixture text")), 409, "AI_PROVIDER_UNAVAILABLE");
            assertThat(http.call("DELETE", "/ai/connections/" + customConnection + "?provider=" + customId + "&revision=1", null)
                    .statusCode()).isEqualTo(204);
            for (String path : List.of("/ai/probe", "/ai/probe/stream")) {
                var failure = http.call("POST", path, Map.of("modelId", "deepseek-flash", "text", "Test prompt"));
                assertThat(failure.statusCode()).isEqualTo(503);
                assertThat(failure.body()).contains("AI_KEY_UNAVAILABLE").doesNotContain(fixtureKey);
            }
            assertThat(encryptedKey(context)).containsExactly(original);
            assertThat(http.call("GET", "/ai/settings?provider=kimi", null).body()).contains("Kimi Test");
            var previous = json.readTree(http.call("GET", "/ai/conversations/" + initialConversation, null).body()).path("conversation");
            assertThat(previous.path("providerId").asText()).isEqualTo("kimi");
            var currentDefault = json.readTree(http.call("GET", "/ai/default-model", null).body());
            assertThat(currentDefault.path("providerId").asText()).isEqualTo("deepseek");
            assertThat(currentDefault.path("connectionId").asText()).isEqualTo(secondConnection);
            assertThat(currentDefault.path("revision").asLong()).isEqualTo(3);
            assertThat(http.call("GET", "/ai/settings?provider=deepseek&connection=" + secondConnection, null).body())
                    .contains("DeepSeek Work", "\"credentialRevision\":1");
            String deleteWork = "/ai/connections/" + secondConnection + "?provider=deepseek&revision=";
            assertFailure(http.call("DELETE", deleteWork + "1", null), 409, "AI_SETTINGS_CONFLICT");
            assertThat(http.call("DELETE", deleteWork + "2", null).statusCode()).isEqualTo(204);
            assertThat(http.call("DELETE", deleteWork + "2", null).statusCode()).isEqualTo(204);
            assertThat(http.call("GET", "/ai/providers", null).body()).doesNotContain(secondConnection);
            assertThat(http.call("GET", "/ai/settings?provider=deepseek&connection=" + secondConnection, null).statusCode())
                    .isEqualTo(404);
            var missingDefault = http.call("POST", "/ai/conversations", Map.of());
            assertThat(missingDefault.statusCode()).isEqualTo(200);
            assertThat(json.readTree(missingDefault.body()).path("connectionId").asText()).isEqualTo(secondConnection);
            assertThat(http.call("PUT", "/ai/default-model", Map.of("revision", 3)).statusCode()).isEqualTo(200);
            assertThat(json.readTree(http.call("POST", "/ai/conversations", Map.of()).body()).path("modelId").asText()).isEmpty();

            var db = context.getBean(JdbcTemplate.class);
            db.update("""
                    UPDATE ai_provider_settings p JOIN ai_provider_connection c ON p.provider_id=c.id
                    SET p.api_key_encrypted=c.api_key_encrypted WHERE p.provider_id='kimi'
                    """);
            assertThat(http.call("DELETE", "/ai/connections/kimi?provider=kimi&revision=1", null).statusCode()).isEqualTo(204);
            assertThat(db.queryForObject("SELECT COUNT(*) FROM ai_provider_settings WHERE provider_id='kimi' AND api_key_encrypted IS NOT NULL",
                    Integer.class)).isZero();
            assertThat(http.call("GET", "/ai/conversations/" + initialConversation, null).body()).contains("\"connectionId\":\"kimi\"");
            var replacement = http.call("POST", "/ai/connections", Map.of("providerId", "kimi", "name", "Kimi Test",
                    "apiKey", "fixture-replacement-" + UUID.randomUUID()));
            assertThat(replacement.statusCode()).isEqualTo(200);
            assertThat(json.readTree(replacement.body()).path("connectionId").asText()).isNotEqualTo("kimi");
        }
    }

    private byte[] encryptedKey(ConfigurableApplicationContext context) {
        return context.getBean(JdbcTemplate.class)
                .queryForObject("SELECT api_key_encrypted FROM ai_provider_connection WHERE id='deepseek'", byte[].class);
    }

    private String seedHistory(JdbcTemplate db, String chatId) {
        // Synthetic history in isolated MySQL exercises the real guard without sending private text or fake Keys upstream.
        String turnId = UUID.randomUUID().toString();
        db.update("""
                INSERT INTO ai_chat_turn(id, conversation_id, position, prompt, reply, provider, model_id, status, selected_answer_id)
                VALUES (?, ?, 1, 'Fixture prompt', 'Fixture answer', 'DeepSeek Test', 'deepseek-flash', 'complete', ?)
                """, turnId, chatId, turnId);
        db.update("""
                INSERT INTO ai_chat_answer(id, turn_id, version, reply, provider, model_id, status, provider_id, connection_id)
                VALUES (?, ?, 1, 'Fixture answer', 'DeepSeek Test', 'deepseek-flash', 'complete', 'deepseek', 'deepseek')
                """, turnId, turnId);
        db.update("UPDATE ai_conversation SET revision=1 WHERE id=?", chatId);
        return turnId;
    }

    private void assertFailure(HttpResponse<String> response, int status, String code) {
        assertThat(response.statusCode()).isEqualTo(status);
        assertThat(response.body()).contains(code);
    }

    private static String encryptionKey() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }

    private ConfigurableApplicationContext start(String key, String customAddress) throws Exception {
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
        properties.put("PRIVATE_SPACE_AI_CUSTOM_PROVIDERS", json.writeValueAsString(List.of(Map.of("name", "Workspace Gateway", "baseUrl", customAddress))));
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
            if (!method.equals("GET")) csrf = json.readTree(call("GET", "/auth/csrf", null).body()).path("token").asText();
            var request = HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(10));
            if (!cookies.isEmpty()) request.header("Cookie", String.join("; ", cookies.values()));
            if (method.equals("GET")) request.GET();
            else {
                request.header("Origin", "http://127.0.0.1:5173").header("X-CSRF-TOKEN", csrf);
                if (body == null) request.method(method, HttpRequest.BodyPublishers.noBody());
                else request.header("Content-Type", "application/json")
                        .method(method, HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
            }
            var response = client.send(request.build(), HttpResponse.BodyHandlers.ofString());
            for (String cookie : response.headers().allValues("Set-Cookie")) {
                String pair = cookie.split(";", 2)[0];
                cookies.put(pair.split("=", 2)[0], pair);
            }
            return response;
        }
    }
}
