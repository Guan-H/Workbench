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
                           boolean keyConfigured, boolean encryptionReady, String providerId, String providerLabel) {}
    public record Probe(String modelId, String text, String providerId) {}
    public record Usage(Long inputTokens, Long outputTokens, Long totalTokens) {}
    public record Result(String provider, String model, String text, String finishReason, Usage usage, long elapsedMs) {}
}
