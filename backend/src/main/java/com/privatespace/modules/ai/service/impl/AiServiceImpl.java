package com.privatespace.modules.ai.service.impl;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.ai.dto.AiRequests.Model;
import com.privatespace.modules.ai.dto.AiRequests.Probe;
import com.privatespace.modules.ai.dto.AiRequests.Result;
import com.privatespace.modules.ai.dto.AiRequests.Save;
import com.privatespace.modules.ai.dto.AiRequests.Settings;
import com.privatespace.modules.ai.dto.AiChat.Message;
import com.privatespace.modules.ai.entity.DeepSeekSettingsEntity;
import com.privatespace.modules.ai.mapper.DeepSeekSettingsMapper;
import com.privatespace.modules.ai.service.AiService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;

@Service
public class AiServiceImpl implements AiService {
    private final DeepSeekSettingsMapper mapper;
    private final AiCredentialCipher cipher;
    private final CompatibleChatClient client;
    private final ObjectMapper json;

    AiServiceImpl(DeepSeekSettingsMapper mapper, AiCredentialCipher cipher, CompatibleChatClient client, ObjectMapper json) {
        this.mapper = mapper;
        this.cipher = cipher;
        this.client = client;
        this.json = json;
    }

    @Override
    public List<Settings> providers() {
        return Arrays.stream(AiProvider.values()).map(provider -> view(provider, read(provider))).toList();
    }

    @Override
    public Settings settings(String id) {
        AiProvider provider = AiProvider.from(id);
        return view(provider, read(provider));
    }

    @Override
    @Transactional
    public Settings save(String id, Save request) {
        AiProvider provider = AiProvider.from(id);
        if (request.revision() < 0 || request.models() == null || request.models().size() > 20) throw invalid();
        String providerName = required(request.providerName(), 80);
        var models = new ArrayList<Model>();
        var ids = new HashSet<String>();
        for (Model model : request.models()) {
            if (model == null) throw invalid();
            String modelId = required(model.modelId(), 160);
            if (!modelId.matches("[A-Za-z0-9._:/-]+") || !ids.add(modelId)) throw invalid();
            models.add(new Model(modelId, required(model.name(), 80)));
        }
        byte[] encrypted = null;
        if (request.apiKey() != null && !request.apiKey().isEmpty()) {
            String key = request.apiKey().strip();
            if (!key.matches("[!-~]{1,512}")) throw invalid();
            encrypted = cipher.encrypt(provider, key);
        }
        String serialized = json.writeValueAsString(models);
        int updated = provider == AiProvider.DEEPSEEK
                ? mapper.update(request.revision(), providerName, serialized, encrypted)
                : mapper.updatePreset(provider.id, request.revision(), providerName, serialized, encrypted);
        if (updated != 1) {
            throw new ApiException(409, "AI_SETTINGS_CONFLICT", "AI 设置已变化，请重新读取后编辑。");
        }
        return view(provider, read(provider));
    }

    @Override
    public List<Model> discoverModels(String id) {
        AiProvider provider = AiProvider.from(id);
        // OpenRouter publishes a public catalog; no account credential is needed for this read.
        return client.listModels(provider, provider == AiProvider.OPENROUTER ? null : credential(provider, read(provider)));
    }

    @Override
    public Result probe(Probe request, DeltaSink delta) throws IOException {
        String prompt = required(request.text(), 4000);
        String modelId = required(request.modelId(), 160);
        var source = chatSource(AiProvider.from(request.providerId()), modelId);
        return client.complete(source.endpoint(), source.key(), source.provider(), modelId, List.of(new Message("user", prompt)), 512, delta);
    }

    ChatSource chatSource(AiProvider provider, String modelId) {
        DeepSeekSettingsEntity config = read(provider);
        if (models(config).stream().noneMatch(model -> model.modelId().equals(modelId))) {
            throw new ApiException(400, "AI_MODEL_NOT_CONFIGURED", "请先在 AI 服务设置中保存要使用的模型。");
        }
        return new ChatSource(provider, config.providerName(), credential(provider, config));
    }

    Result streamChat(ChatSource source, String modelId, List<Message> messages, DeltaSink delta) throws IOException {
        return client.complete(source.endpoint(), source.key(), source.provider(), modelId, messages, 2048, delta);
    }

    record ChatSource(AiProvider endpoint, String provider, String key) {
        @Override public String toString() { return "ChatSource[provider=" + provider + "]"; }
    }

    private String credential(AiProvider provider, DeepSeekSettingsEntity config) {
        if (config.encryptedKey() == null) {
            throw new ApiException(400, "AI_KEY_NOT_CONFIGURED", "请先保存该服务商的 API Key。");
        }
        return cipher.decrypt(provider, config.encryptedKey());
    }

    private DeepSeekSettingsEntity read(AiProvider provider) {
        return provider == AiProvider.DEEPSEEK ? mapper.read() : mapper.readPreset(provider.id);
    }

    private Settings view(AiProvider provider, DeepSeekSettingsEntity config) {
        return new Settings(config.revision(), config.providerName(), provider.baseUrl,
                models(config), config.encryptedKey() != null, cipher.ready(), provider.id, provider.label);
    }

    private List<Model> models(DeepSeekSettingsEntity config) {
        return json.readValue(config.models(), new TypeReference<List<Model>>() {});
    }

    private static String required(String input, int maxLength) {
        if (input == null || input.length() > maxLength || input.isBlank()) throw invalid();
        return input.strip();
    }

    private static ApiException invalid() {
        return new ApiException(400, "AI_INVALID_INPUT", "请检查名称、模型 ID、API Key 或测试文字格式。");
    }
}
