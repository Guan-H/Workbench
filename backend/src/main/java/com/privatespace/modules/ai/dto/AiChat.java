package com.privatespace.modules.ai.dto;

import java.time.LocalDateTime;
import java.util.List;

public final class AiChat {
    private AiChat() {}

    public record Conversation(String id, String title, String modelId, int revision, LocalDateTime updatedAt,
                               boolean pinned, String providerId) {}
    public record Turn(String id, String conversationId, int position, String prompt, String reply,
                       String provider, String modelId, String actualModel, String status, String errorMessage,
                       String finishReason, Long elapsedMs, Long totalTokens, String answerId, int version,
                       int revision, String providerId) {}
    public record Version(String turnId, String answerId, int version) {}
    public record Detail(Conversation conversation, List<Turn> turns, List<Version> versions, Turn activeAnswer) {}
    public record Send(String id, int revision, String modelId, String text, String providerId, String confirmedProviderId) {}
    public record Regenerate(String id, int revision, String modelId, String providerId, String confirmedProviderId) {}
    public record SelectAnswer(int revision) {}
    public record Rename(String title, int revision) {}
    public record Pin(Boolean pinned, int revision) {}
    public record Message(String role, String content) {}
}
