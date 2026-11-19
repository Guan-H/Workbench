package com.privatespace.modules.ai.service.impl;

import com.privatespace.common.exception.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Component
class AiProviderCatalog {
    private final Map<String, AiProvider> providers = new LinkedHashMap<>();

    AiProviderCatalog(ObjectMapper json, @Value("${PRIVATE_SPACE_AI_CUSTOM_PROVIDERS:}") String configured) {
        AiProvider.BUILT_INS.forEach(provider -> providers.put(provider.id, provider));
        if (configured.isBlank()) return;
        try {
            List<Registration> registrations = json.readValue(configured, new TypeReference<List<Registration>>() {});
            for (Registration registration : registrations) {
                if (registration.name() == null || registration.name().isBlank() || registration.name().strip().length() > 80) {
                    throw new IllegalArgumentException();
                }
                var provider = custom(registration.baseUrl(), registration.name().strip());
                if (providers.putIfAbsent(provider.id, provider) != null) throw new IllegalArgumentException();
            }
        } catch (RuntimeException invalid) {
            throw new IllegalArgumentException("Invalid PRIVATE_SPACE_AI_CUSTOM_PROVIDERS configuration. Check registration names, HTTPS addresses and duplicates.");
        }
    }

    record Registration(String name, String baseUrl) {}

    List<AiProvider> all() { return List.copyOf(providers.values()); }

    AiProvider find(String id) { return providers.get(id); }

    AiProvider require(String id) {
        String providerId = identity(id);
        AiProvider provider = find(providerId);
        if (provider == null) throw unavailable();
        return provider;
    }

    static ApiException unavailable() {
        return new ApiException(409, "AI_PROVIDER_UNAVAILABLE", "此自定义服务地址已停用，请选择其他连接。");
    }

    static AiProvider custom(String address, String label) {
        String normalized = normalize(address);
        return new AiProvider(destinationId(normalized), label, normalized, "max_tokens", true);
    }

    static String identity(String id) {
        if (id == null || id.isEmpty()) return AiProvider.DEEPSEEK.id;
        if (id.matches("custom-[A-Za-z0-9_-]{17}") || AiProvider.BUILT_INS.stream().anyMatch(provider -> provider.id.equals(id))) return id;
        throw new ApiException(400, "AI_PROVIDER_INVALID", "请选择已支持的 AI 服务商。");
    }

    static String normalize(String address) {
        if (address == null || address.length() > 512) throw new IllegalArgumentException();
        var uri = URI.create(address.strip());
        String host = uri.getHost();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || uri.getRawUserInfo() != null
                || uri.getRawQuery() != null || uri.getRawFragment() != null || (uri.getPort() != -1 && uri.getPort() != 443)) {
            throw new IllegalArgumentException();
        }
        host = host.toLowerCase(Locale.ROOT);
        if (host.length() > 253 || !host.matches("(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z][a-z0-9-]{0,62}")
                || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) {
            throw new IllegalArgumentException();
        }
        String path = uri.getRawPath();
        if (!path.matches("(?:/[A-Za-z0-9._~-]+)*/?") || !path.equals(uri.normalize().getRawPath())) {
            throw new IllegalArgumentException();
        }
        return "https://" + host + (path.endsWith("/") ? path.substring(0, path.length() - 1) : path);
    }

    private static String destinationId(String address) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(address.getBytes(StandardCharsets.US_ASCII));
            return "custom-" + Base64.getUrlEncoder().withoutPadding().encodeToString(digest).substring(0, 17);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
