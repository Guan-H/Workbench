package com.privatespace.modules.document.service.impl;

import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.Map;
import com.privatespace.common.exception.ApiException;
import com.privatespace.config.OfficeProperties;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
public class OfficeClient {
    private final OfficeProperties properties;
    private final OfficeTokens tokens;
    private final ObjectMapper json;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
    public OfficeClient(OfficeProperties properties, OfficeTokens tokens, ObjectMapper json) { this.properties=properties; this.tokens=tokens; this.json=json; }
    public JsonNode request(String path, Map<String,Object> value) {
        var body = new java.util.LinkedHashMap<>(value); body.put("token", tokens.sign(value));
        try {
            var request = HttpRequest.newBuilder(URI.create(properties.serverUrl() + path)).timeout(Duration.ofSeconds(60))
                    .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode()!=200 || response.body().length()>1048576) throw new IllegalStateException();
            return json.readTree(response.body());
        } catch (Exception exception) { if (exception instanceof InterruptedException) Thread.currentThread().interrupt(); throw new ApiException(503,"OFFICE_UNAVAILABLE","文档服务未响应，请保留编辑页面并稍后重试。"); }
    }
    /** Callback URLs may only address the configured document server, never arbitrary internal hosts or redirects. */
    public byte[] download(String address) {
        try {
            URI uri=URI.create(address), server=URI.create(properties.serverUrl());
            if (uri.getUserInfo()!=null || uri.getFragment()!=null || !uri.getScheme().equals(server.getScheme()) || !uri.getAuthority().equals(server.getAuthority())
                    || !uri.getPath().startsWith("/cache/") || uri.getPath().contains("..") || !uri.normalize().equals(uri)) throw new IllegalArgumentException();
            var response=client.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(60)).GET().build(),HttpResponse.BodyHandlers.ofInputStream());
            try (var stream=response.body()) {
                if (response.statusCode()!=200) throw new IllegalArgumentException();
                byte[] bytes=stream.readNBytes(50*1024*1024+1);
                if (bytes.length>50*1024*1024) throw new IllegalArgumentException();
                return bytes;
            }
        } catch (Exception exception) { if (exception instanceof InterruptedException) Thread.currentThread().interrupt(); throw new ApiException(502,"OFFICE_RESULT_UNAVAILABLE","文档结果地址不可信、文件过大或读取失败，尚未确认保存。"); }
    }
}
