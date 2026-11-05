package com.privatespace.modules.vault.service.impl;

import java.util.Base64;
import java.util.Set;
import java.util.UUID;

import com.privatespace.common.exception.ApiException;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/** Validates public format and allocation bounds; authentication happens only in the browser. */
@Component
public class VaultEnvelopeValidator {
    public String validate(JsonNode envelope) {
        fields(envelope, Set.of("format", "version", "purpose", "vaultId", "keyId", "kdf", "wrappedKey", "payload"));
        require("private-space-vault".equals(envelope.path("format").asText())
                && envelope.path("version").isInt() && envelope.path("version").asInt() == 1
                && "vault".equals(envelope.path("purpose").asText()));
        String id = uuid(envelope.path("vaultId"));
        uuid(envelope.path("keyId"));
        var kdf = envelope.path("kdf");
        fields(kdf, Set.of("algorithm", "ops", "memory", "salt"));
        require("argon2id13".equals(kdf.path("algorithm").asText())
                && kdf.path("ops").isInt() && kdf.path("ops").asInt() == 3
                && kdf.path("memory").isInt() && kdf.path("memory").asInt() == 67108864);
        encoded(kdf.path("salt"), 16, 16);
        var wrapped = envelope.path("wrappedKey");
        fields(wrapped, Set.of("nonce", "ciphertext"));
        encoded(wrapped.path("nonce"), 24, 24);
        encoded(wrapped.path("ciphertext"), 48, 48);
        var payload = envelope.path("payload");
        fields(payload, Set.of("id", "nonce", "ciphertext"));
        uuid(payload.path("id"));
        encoded(payload.path("nonce"), 24, 24);
        encoded(payload.path("ciphertext"), 16, 1048592);
        return id;
    }

    private void fields(JsonNode node, Set<String> names) {
        require(node != null && node.isObject() && node.size() == names.size());
        for (String name : names) require(node.has(name));
    }

    private String uuid(JsonNode node) {
        require(node.isString() && node.asText().matches("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"));
        return UUID.fromString(node.asText()).toString();
    }

    private void encoded(JsonNode node, int min, int max) {
        require(node.isString() && node.asText().length() <= (max * 4 + 2) / 3);
        try {
            byte[] decoded = Base64.getUrlDecoder().decode(node.asText());
            require(decoded.length >= min && decoded.length <= max
                    && Base64.getUrlEncoder().withoutPadding().encodeToString(decoded).equals(node.asText()));
        } catch (IllegalArgumentException exception) { require(false); }
    }

    private void require(boolean valid) {
        if (!valid) throw new ApiException(400, "INVALID_VAULT_FORMAT", "保险库格式不支持或参数不正确，原数据未改变。");
    }
}
