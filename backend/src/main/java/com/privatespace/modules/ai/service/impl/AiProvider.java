package com.privatespace.modules.ai.service.impl;

import com.privatespace.common.exception.ApiException;
import java.util.Arrays;

/** Fixed outbound destinations; settings never accept an arbitrary endpoint. */
enum AiProvider {
    DEEPSEEK("deepseek", "DeepSeek", "https://api.deepseek.com", "max_tokens"),
    OPENAI("openai", "OpenAI", "https://api.openai.com/v1", "max_completion_tokens"),
    KIMI("kimi", "Kimi", "https://api.moonshot.cn/v1", "max_completion_tokens"),
    SILICONFLOW("siliconflow", "硅基流动", "https://api.siliconflow.cn/v1", "max_tokens"),
    OPENROUTER("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "max_tokens");

    final String id;
    final String label;
    final String baseUrl;
    final String tokenParameter;

    AiProvider(String id, String label, String baseUrl, String tokenParameter) {
        this.id = id;
        this.label = label;
        this.baseUrl = baseUrl;
        this.tokenParameter = tokenParameter;
    }

    static AiProvider from(String id) {
        if (id == null || id.isEmpty()) return DEEPSEEK;
        return Arrays.stream(values()).filter(provider -> provider.id.equals(id)).findFirst()
                .orElseThrow(() -> new ApiException(400, "AI_PROVIDER_INVALID", "请选择已支持的 AI 服务商。"));
    }
}
