package com.privatespace.modules.ai.service.impl;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.ai.dto.AiRequests.Model;
import com.privatespace.modules.ai.dto.AiChat.Message;
import com.privatespace.modules.ai.dto.AiRequests.Result;
import com.privatespace.modules.ai.dto.AiRequests.Usage;
import com.privatespace.modules.ai.service.AiService.DeltaSink;
import jakarta.annotation.PreDestroy;
import org.apache.hc.client5.http.classic.methods.HttpUriRequestBase;
import org.apache.hc.client5.http.config.ConnectionConfig;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.core5.http.ContentType;
import org.apache.hc.core5.http.io.entity.ByteArrayEntity;
import org.apache.hc.core5.util.Timeout;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import javax.net.ssl.HttpsURLConnection;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.InterruptedIOException;
import java.net.Proxy;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

@Component
class CompatibleChatClient {
    private static final int MAX_RESPONSE_CHARS = 2_000_000;
    private final ObjectMapper json;
    private final Semaphore slots = new Semaphore(2);
    private final CloseableHttpClient customClient = HttpClients.custom()
            .setConnectionManager(PoolingHttpClientConnectionManagerBuilder.create()
                    .setDnsResolver(new PublicAiDnsResolver())
                    .setDefaultConnectionConfig(ConnectionConfig.custom().setConnectTimeout(Timeout.ofSeconds(8))
                            .setSocketTimeout(Timeout.ofSeconds(25)).build())
                    .build())
            .setDefaultRequestConfig(RequestConfig.custom().setConnectionRequestTimeout(Timeout.ofSeconds(8))
                    .setResponseTimeout(Timeout.ofSeconds(25)).build())
            .setConnectionReuseStrategy((request, response, context) -> false)
            .disableRedirectHandling().disableAutomaticRetries().disableCookieManagement()
            .disableAuthCaching().disableContentCompression().build();

    CompatibleChatClient(ObjectMapper json) {
        this.json = json;
    }

    @PreDestroy
    void closeCustomClient() throws IOException { customClient.close(); }

    List<Model> listModels(AiProvider endpoint, String key) {
        acquireSlot();
        long started = System.nanoTime();
        try {
            return exchange(endpoint, "/models", key, "application/json", null, reader -> {
                JsonNode data = parse(readBody(new BoundedResponse(reader, started))).path("data");
                if (!data.isArray()) throw protocolError();
                var models = new LinkedHashMap<String, Model>();
                for (JsonNode entry : data) {
                    if (endpoint == AiProvider.OPENROUTER && entry.path("endpoints").isArray()) {
                        boolean chat = false;
                        for (JsonNode path : entry.path("endpoints")) {
                            if ("/api/v1/chat/completions".equals(string(path))) chat = true;
                        }
                        if (!chat) continue;
                    }
                    String id = string(entry.path("id"));
                    if (id == null || !id.matches("[A-Za-z0-9._:/-]{1,160}")) continue;
                    String name = string(entry.path("name"));
                    if (name == null || name.isBlank() || name.length() > 80) {
                        name = id.length() <= 80 ? id : id.substring(0, 80);
                    }
                    models.putIfAbsent(id, new Model(id, name));
                }
                return List.copyOf(models.values());
            });
        } catch (SocketTimeoutException ignored) {
            throw new ApiException(504, "AI_UPSTREAM_TIMEOUT", "读取服务商模型列表超时。");
        } catch (IOException ignored) {
            throw new ApiException(502, "AI_UPSTREAM_CONNECTION", "无法读取服务商模型列表，请检查后端网络出口。");
        } finally {
            slots.release();
        }
    }

    Result complete(AiProvider endpoint, String key, String provider, String model, List<Message> messages, int maxTokens,
                    DeltaSink delta) throws IOException {
        acquireSlot();
        long started = System.nanoTime();
        try {
            var request = new LinkedHashMap<String, Object>(Map.of(
                    "model", model, "messages", messages, endpoint.tokenParameter, maxTokens, "stream", delta != null));
            if (endpoint == AiProvider.DEEPSEEK) request.put("thinking", Map.of("type", "disabled"));
            if ((endpoint == AiProvider.OPENAI || endpoint == AiProvider.KIMI) && delta != null) {
                request.put("stream_options", Map.of("include_usage", true));
            }
            byte[] body = json.writeValueAsBytes(request);
            String expected = delta == null ? "application/json" : "text/event-stream";
            if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
            return exchange(endpoint, "/chat/completions", key, expected, body, reader -> {
                var response = new BoundedResponse(reader, started);
                return delta == null ? regular(response, provider, started) : streaming(response, provider, started, delta);
            });
        } catch (SocketTimeoutException ignored) {
            throw new ApiException(504, "AI_UPSTREAM_TIMEOUT", "服务商响应超时。");
        } catch (DownstreamClosed closed) {
            throw closed;
        } catch (IOException ignored) {
            throw new ApiException(502, "AI_UPSTREAM_CONNECTION", "无法读取服务商响应，请检查后端网络出口。");
        } finally {
            slots.release();
        }
    }

    private void acquireSlot() {
        if (!slots.tryAcquire()) throw new ApiException(429, "AI_BUSY", "已有 AI 请求正在运行，请稍后重试。");
    }

    private <T> T exchange(AiProvider endpoint, String path, String key, String expected, byte[] body,
                           ReadResponse<T> read) throws IOException {
        if (endpoint.custom) {
            var request = new HttpUriRequestBase(body == null ? "GET" : "POST", URI.create(endpoint.baseUrl + path));
            request.setHeader("Accept", expected);
            if (key != null) request.setHeader("Authorization", "Bearer " + key);
            if (body != null) request.setEntity(new ByteArrayEntity(body, ContentType.APPLICATION_JSON));
            try (var response = customClient.executeOpen(null, request, null)) {
                var entity = response.getEntity();
                verifyResponse(response.getCode(), entity == null ? null : entity.getContentType(), expected);
                return readResponse(entity.getContent(), read);
            }
        }
        var connection = connect(endpoint, path, key, expected);
        try {
            if (body != null) {
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(body.length);
                try (var output = connection.getOutputStream()) { output.write(body); }
            }
            verifyResponse(connection.getResponseCode(), connection.getContentType(), expected);
            return readResponse(connection.getInputStream(), read);
        } finally {
            connection.disconnect();
        }
    }

    private static <T> T readResponse(InputStream input, ReadResponse<T> read) throws IOException {
        try (var reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            return read.read(reader);
        }
    }

    @FunctionalInterface
    private interface ReadResponse<T> { T read(BufferedReader reader) throws IOException; }

    private static HttpsURLConnection connect(AiProvider endpoint, String path, String key, String accept) throws IOException {
        var connection = (HttpsURLConnection) URI.create(endpoint.baseUrl + path).toURL().openConnection(Proxy.NO_PROXY);
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(25000);
        if (key != null) connection.setRequestProperty("Authorization", "Bearer " + key);
        connection.setRequestProperty("Accept", accept);
        return connection;
    }

    private static void verifyResponse(int status, String contentType, String expected) {
        if (status != 200) throw upstreamError(status);
        if (contentType == null || !expected.equalsIgnoreCase(contentType.split(";", 2)[0].strip())) {
            throw protocolError();
        }
    }

    private Result regular(BoundedResponse response, String provider, long started) throws IOException {
        JsonNode root = parse(readBody(response));
        JsonNode choice = root.path("choices").path(0);
        return result(provider, string(root.path("model")), string(choice.path("message").path("content")),
                string(choice.path("finish_reason")), usage(root.path("usage")), started);
    }

    private String readBody(BoundedResponse response) throws IOException {
        StringBuilder body = new StringBuilder();
        for (String line; (line = response.line()) != null;) body.append(line).append('\n');
        return body.toString();
    }

    private Result streaming(BoundedResponse response, String provider, long started, DeltaSink delta) throws IOException {
        StringBuilder text = new StringBuilder();
        String model = null;
        String finish = null;
        Usage usage = null;
        StringBuilder event = new StringBuilder();
        for (String line; (line = response.line()) != null;) {
            if (line.startsWith("data:")) {
                if (!event.isEmpty()) event.append('\n');
                String value = line.substring(5);
                event.append(value.startsWith(" ") ? value.substring(1) : value);
            }
            if (!line.isEmpty() || event.isEmpty()) continue;
            String data = event.toString();
            event.setLength(0);
            if ("[DONE]".equals(data)) return result(provider, model, text.toString(), finish, usage, started);
            JsonNode root = parse(data);
            String reportedModel = string(root.path("model"));
            if (reportedModel != null) model = reportedModel;
            if (root.path("usage").isObject()) usage = usage(root.path("usage"));
            JsonNode choice = root.path("choices").path(0);
            String reason = string(choice.path("finish_reason"));
            if (reason != null) finish = reason;
            String chunk = string(choice.path("delta").path("content"));
            if (chunk != null && !chunk.isEmpty()) {
                text.append(chunk);
                try {
                    delta.accept(chunk);
                } catch (IOException ignored) {
                    throw new DownstreamClosed();
                }
            }
        }
        throw new ApiException(502, "AI_STREAM_INTERRUPTED", "服务商的流式回复提前中断。");
    }

    private JsonNode parse(String body) {
        try {
            JsonNode root = json.readTree(body);
            if (root == null || !root.isObject() || root.hasNonNull("error")) throw protocolError();
            return root;
        } catch (tools.jackson.core.JacksonException ignored) {
            throw protocolError();
        }
    }

    private static Result result(String provider, String model, String text, String finish, Usage usage, long started) {
        if (model == null || model.isBlank() || text == null || text.isBlank() || finish == null) throw protocolError();
        if (!"stop".equals(finish) && !"length".equals(finish)) {
            throw new ApiException(502, "AI_INCOMPLETE", "服务商未正常完成文字回复。");
        }
        return new Result(provider, model, text, finish, usage, TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
    }

    private static Usage usage(JsonNode node) {
        return node.isObject() ? new Usage(tokens(node.path("prompt_tokens")),
                tokens(node.path("completion_tokens")), tokens(node.path("total_tokens"))) : null;
    }

    private static Long tokens(JsonNode node) {
        return node.isIntegralNumber() && node.canConvertToLong() && node.longValue() >= 0 ? node.longValue() : null;
    }

    private static String string(JsonNode node) {
        return node.isTextual() ? node.asText() : null;
    }

    private static ApiException protocolError() {
        return new ApiException(502, "AI_UPSTREAM_PROTOCOL", "服务商返回的文字回复格式不完整或不兼容。");
    }

    private static ApiException upstreamError(int status) {
        return switch (status) {
            case 401, 403 -> new ApiException(422, "AI_UPSTREAM_AUTH", "服务商拒绝了凭据或模型权限，请检查设置。");
            case 402 -> new ApiException(422, "AI_UPSTREAM_QUOTA", "服务商账户余额不足或额度不可用。");
            case 400, 404, 422 -> new ApiException(422, "AI_UPSTREAM_INPUT", "服务商拒绝了请求，请检查模型 ID 和输入。");
            case 429 -> new ApiException(429, "AI_UPSTREAM_RATE_LIMIT", "服务商返回限流或额度限制，请核对后重试。");
            default -> new ApiException(502, "AI_UPSTREAM_UNAVAILABLE", "服务商暂时无法处理请求。");
        };
    }

    private static final class DownstreamClosed extends IOException {}

    private static final class BoundedResponse {
        private final BufferedReader reader;
        private final long started;
        private int chars;

        BoundedResponse(BufferedReader reader, long started) {
            this.reader = reader;
            this.started = started;
        }

        String line() throws IOException {
            StringBuilder line = new StringBuilder();
            for (int value; (value = reader.read()) != -1;) {
                if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
                if (++chars > MAX_RESPONSE_CHARS) throw protocolError();
                if (System.nanoTime() - started > TimeUnit.SECONDS.toNanos(90)) throw new SocketTimeoutException();
                if (value == '\n') {
                    if (!line.isEmpty() && line.charAt(line.length() - 1) == '\r') line.setLength(line.length() - 1);
                    return line.toString();
                }
                line.append((char) value);
            }
            return line.isEmpty() ? null : line.toString();
        }
    }
}
