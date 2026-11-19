package com.privatespace.modules.ai.service.impl;

import java.util.List;

/** Destinations come from the application or trusted server configuration. */
final class AiProvider {
    static final AiProvider DEEPSEEK = new AiProvider("deepseek", "DeepSeek", "https://api.deepseek.com", "max_tokens", false);
    static final AiProvider OPENAI = new AiProvider("openai", "OpenAI", "https://api.openai.com/v1", "max_completion_tokens", false);
    static final AiProvider KIMI = new AiProvider("kimi", "Kimi", "https://api.moonshot.cn/v1", "max_completion_tokens", false);
    static final AiProvider SILICONFLOW = new AiProvider("siliconflow", "硅基流动", "https://api.siliconflow.cn/v1", "max_tokens", false);
    static final AiProvider OPENROUTER = new AiProvider("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "max_tokens", false);
    static final List<AiProvider> BUILT_INS = List.of(DEEPSEEK, OPENAI, KIMI, SILICONFLOW, OPENROUTER);

    final String id;
    final String label;
    final String baseUrl;
    final String tokenParameter;
    final boolean custom;

    AiProvider(String id, String label, String baseUrl, String tokenParameter, boolean custom) {
        this.id = id;
        this.label = label;
        this.baseUrl = baseUrl;
        this.tokenParameter = tokenParameter;
        this.custom = custom;
    }
}
