package com.privatespace.modules.ai.dto;

import java.util.List;

public final class AiRequests {
    private AiRequests() {}

    public record Model(String modelId, String name) {}
    public record Save(long revision, String providerName, List<Model> models, String apiKey) {
        @Override
        public String toString() {
            return "AiSettingsSave[revision=" + revision + "]";
        }
    }
    public record Settings(long revision, String providerName, String baseUrl, List<Model> models,
                           boolean keyConfigured, boolean encryptionReady, String providerId, String providerLabel,
                           String connectionId, long credentialRevision, boolean available) {}
    public record ProviderPreset(String id, String label, String baseUrl, boolean custom) {}
    public record CreateConnection(String providerId, String name, String apiKey, String baseUrl) {
        @Override
        public String toString() {
            return "AiConnectionCreate[providerId=" + providerId + "]";
        }
    }
    public record Probe(String modelId, String text, String providerId, String connectionId) {}
    public record DefaultModel(long revision, String providerId, String modelId, String connectionId) {}
    public record Usage(Long inputTokens, Long outputTokens, Long totalTokens) {}
    public record Result(String provider, String model, String text, String finishReason, Usage usage, long elapsedMs) {}
}
