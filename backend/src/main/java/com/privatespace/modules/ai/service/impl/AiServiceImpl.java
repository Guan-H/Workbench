package com.privatespace.modules.ai.service.impl;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.ai.dto.AiRequests.CreateConnection;
import com.privatespace.modules.ai.dto.AiRequests.DefaultModel;
import com.privatespace.modules.ai.dto.AiRequests.Model;
import com.privatespace.modules.ai.dto.AiRequests.ProviderPreset;
import com.privatespace.modules.ai.dto.AiRequests.Probe;
import com.privatespace.modules.ai.dto.AiRequests.Result;
import com.privatespace.modules.ai.dto.AiRequests.Save;
import com.privatespace.modules.ai.dto.AiRequests.Settings;
import com.privatespace.modules.ai.dto.AiChat.Message;
import com.privatespace.modules.ai.entity.AiConnectionEntity;
import com.privatespace.modules.ai.mapper.AiConnectionMapper;
import com.privatespace.modules.ai.mapper.AiChatPreferenceMapper;
import com.privatespace.modules.ai.service.AiService;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;

@Service
public class AiServiceImpl implements AiService {
    private final AiConnectionMapper mapper;
    private final AiProviderCatalog catalog;
    private final AiChatPreferenceMapper preferences;
    private final AiCredentialCipher cipher;
    private final CompatibleChatClient client;
    private final ObjectMapper json;

    AiServiceImpl(AiConnectionMapper mapper, AiChatPreferenceMapper preferences, AiCredentialCipher cipher,
                  CompatibleChatClient client, ObjectMapper json, AiProviderCatalog catalog) {
        this.mapper = mapper;
        this.preferences = preferences;
        this.cipher = cipher;
        this.client = client;
        this.json = json;
        this.catalog = catalog;
    }

    @Override
    public List<Settings> providers() {
        return mapper.list().stream().map(this::view).toList();
    }

    @Override
    public List<ProviderPreset> providerPresets() {
        return catalog.all().stream().map(provider -> new ProviderPreset(provider.id, provider.label, provider.baseUrl, provider.custom)).toList();
    }

    @Override
    @Transactional
    public Settings createConnection(CreateConnection request) {
        String providerId = required(request.providerId(), 24);
        String name = required(request.name(), 80);
        String key = requiredKey(request.apiKey());
        AiProvider provider;
        String baseUrl = null;
        if ("custom".equals(providerId)) {
            try {
                provider = AiProviderCatalog.custom(request.baseUrl(), "自定义服务");
            } catch (IllegalArgumentException error) {
                throw new ApiException(400, "AI_CUSTOM_URL_INVALID", "请填写公网 HTTPS 服务地址，例如 https://api.example.com/v1。");
            }
            baseUrl = provider.baseUrl;
        } else {
            if (request.baseUrl() != null) {
                throw new ApiException(400, "AI_CUSTOM_URL_NOT_ALLOWED", "预设服务使用自己的地址，请选择自定义服务后填写地址。");
            }
            provider = catalog.require(providerId);
        }
        // Unconfigured connections from earlier versions keep their model settings when first given a Key.
        var placeholder = mapper.unconfigured(provider.id, name);
        String id = placeholder == null ? UUID.randomUUID().toString() : placeholder.id();
        byte[] encrypted = cipher.encrypt(provider, id, key);
        try {
            if (placeholder == null) mapper.insert(id, provider.id, name, encrypted, baseUrl);
            else if (mapper.activate(id, placeholder.revision(), name, encrypted, baseUrl) != 1) throw settingsConflict();
        } catch (DuplicateKeyException duplicate) {
            throw duplicateConnectionName();
        }
        return view(connection(provider.id, id));
    }

    @Override
    @Transactional
    public void deleteConnection(String providerId, String id, long revision) {
        if (revision < 0) throw invalid();
        String identity = AiProviderCatalog.identity(required(providerId, 24));
        var current = findConnection(identity, id);
        if (current == null || current.encryptedKey() == null) return;
        if (mapper.delete(current.id(), revision) != 1) throw settingsConflict();
        // V36 copied preset credentials into the new table. Delete the matching legacy copy as well.
        if (current.id().equals(identity)) {
            if (identity.equals(AiProvider.DEEPSEEK.id)) mapper.clearLegacyDeepSeekKey();
            else mapper.clearLegacyPresetKey(identity);
        }
    }

    @Override
    public Settings settings(String providerId, String connectionId) {
        return view(connection(AiProviderCatalog.identity(providerId), connectionId));
    }

    @Override
    public DefaultModel defaultModel() {
        return preferences.read();
    }

    @Override
    @Transactional
    public DefaultModel saveDefaultModel(DefaultModel request) {
        if (request.revision() < 0 || (request.providerId() == null) != (request.modelId() == null)) throw invalid();
        if (request.providerId() == null && request.connectionId() != null) throw invalid();
        if (request.providerId() != null) {
            String providerId = AiProviderCatalog.identity(required(request.providerId(), 24));
            String model = required(request.modelId(), 160);
            var settings = connection(providerId, request.connectionId());
            requireProvider(settings);
            if (!cipher.ready() || settings.encryptedKey() == null
                    || models(settings).stream().noneMatch(item -> item.modelId().equals(model))) {
                throw new ApiException(400, "AI_DEFAULT_MODEL_UNAVAILABLE", "请先保存该服务商的 API Key 和模型，再设为默认。");
            }
            request = new DefaultModel(request.revision(), providerId, model, settings.id());
        }
        if (preferences.update(request) != 1) {
            throw new ApiException(409, "AI_DEFAULT_MODEL_CONFLICT", "默认模型已变化，请重新读取后保存。");
        }
        return preferences.read();
    }

    @Override
    @Transactional
    public Settings save(String providerId, String connectionId, Save request) {
        var current = connection(AiProviderCatalog.identity(providerId), connectionId);
        AiProvider provider = requireProvider(current);
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
            encrypted = cipher.encrypt(provider, current.id(), requiredKey(request.apiKey()));
        }
        String serialized = json.writeValueAsString(models);
        int updated;
        try {
            int credentialChanged = encrypted != null && current.encryptedKey() != null ? 1 : 0;
            updated = mapper.update(current.id(), request.revision(), providerName, serialized, encrypted, credentialChanged);
        } catch (DuplicateKeyException duplicate) {
            throw duplicateConnectionName();
        }
        if (updated != 1) throw settingsConflict();
        return view(connection(provider.id, current.id()));
    }

    @Override
    public List<Model> discoverModels(String providerId, String connectionId) {
        var config = connection(AiProviderCatalog.identity(providerId), connectionId);
        AiProvider provider = requireProvider(config);
        // OpenRouter publishes a public catalog; no account credential is needed for this read.
        return client.listModels(provider, provider == AiProvider.OPENROUTER ? null : credential(provider, config));
    }

    @Override
    public Result probe(Probe request, DeltaSink delta) throws IOException {
        String prompt = required(request.text(), 4000);
        String modelId = required(request.modelId(), 160);
        var source = chatSource(connection(AiProviderCatalog.identity(request.providerId()), request.connectionId()), modelId);
        return client.complete(source.endpoint(), source.key(), source.provider(), modelId, List.of(new Message("user", prompt)), 512, delta);
    }

    ChatSource chatSource(AiConnectionEntity config, String modelId) {
        AiProvider provider = requireProvider(config);
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

    private String credential(AiProvider provider, AiConnectionEntity config) {
        if (config.encryptedKey() == null) {
            throw new ApiException(400, "AI_KEY_NOT_CONFIGURED", "请先保存该连接的 API Key。");
        }
        return cipher.decrypt(provider, config.id(), config.encryptedKey());
    }

    static String connectionId(String providerId, String id) {
        if (id == null) return providerId;
        if (!id.equals(providerId) && !id.matches("[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}")) throw invalid();
        return id;
    }

    AiConnectionEntity connection(String providerId, String id) {
        AiConnectionEntity config = findConnection(providerId, id);
        if (config == null) {
            throw new ApiException(404, "AI_CONNECTION_NOT_FOUND", "此 AI 连接不存在或与服务商不匹配。");
        }
        return config;
    }

    AiConnectionEntity findConnection(String providerId, String id) {
        var config = mapper.read(connectionId(providerId, id));
        return config != null && providerId.equals(config.providerId()) ? config : null;
    }

    private Settings view(AiConnectionEntity config) {
        var provider = providerFor(config);
        return new Settings(config.revision(), config.providerName(), provider == null ? "" : provider.baseUrl,
                models(config), config.encryptedKey() != null, cipher.ready(), config.providerId(),
                provider == null ? "自定义服务" : provider.label, config.id(), config.credentialRevision(), provider != null);
    }

    private AiProvider requireProvider(AiConnectionEntity config) {
        var provider = providerFor(config);
        if (provider == null) throw AiProviderCatalog.unavailable();
        return provider;
    }

    private AiProvider providerFor(AiConnectionEntity config) {
        var registered = catalog.find(config.providerId());
        if (config.baseUrl() == null) return registered;
        try {
            var custom = AiProviderCatalog.custom(config.baseUrl(), "自定义服务");
            if (!custom.id.equals(config.providerId())) return null;
            return registered != null && custom.baseUrl.equals(registered.baseUrl) ? registered : custom;
        } catch (IllegalArgumentException error) {
            return null;
        }
    }

    private List<Model> models(AiConnectionEntity config) {
        return json.readValue(config.models(), new TypeReference<List<Model>>() {});
    }

    private static String required(String input, int maxLength) {
        if (input == null || input.length() > maxLength || input.isBlank()) throw invalid();
        return input.strip();
    }

    private static String requiredKey(String input) {
        if (input == null || input.isBlank()) {
            throw new ApiException(400, "AI_KEY_NOT_CONFIGURED", "请填写该连接的 API Key。");
        }
        String key = input.strip();
        if (!key.matches("[!-~]{1,512}")) throw invalid();
        return key;
    }

    private static ApiException settingsConflict() {
        return new ApiException(409, "AI_SETTINGS_CONFLICT", "AI 设置已变化，请重新读取后操作。");
    }

    private static ApiException invalid() {
        return new ApiException(400, "AI_INVALID_INPUT", "请检查名称、模型 ID、API Key 或测试文字格式。");
    }

    private static ApiException duplicateConnectionName() {
        return new ApiException(409, "AI_CONNECTION_NAME_EXISTS", "该服务商已存在同名连接，请换一个名称。");
    }
}
