package com.privatespace.modules.ai.service.impl;

import com.privatespace.common.exception.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

@Component
class AiCredentialCipher {
    private static final byte FORMAT_VERSION = 1;
    private static final int NONCE_BYTES = 12;
    private final SecureRandom random = new SecureRandom();
    private final SecretKeySpec key;

    AiCredentialCipher(@Value("${PRIVATE_SPACE_AI_ENCRYPTION_KEY:}") String configuredKey) {
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(configuredKey.strip());
        } catch (IllegalArgumentException ignored) {
            bytes = new byte[0];
        }
        key = bytes.length == 32 ? new SecretKeySpec(bytes, "AES") : null;
        java.util.Arrays.fill(bytes, (byte) 0);
    }

    boolean ready() {
        return key != null;
    }

    byte[] encrypt(String plaintext) {
        return encrypt(AiProvider.DEEPSEEK, plaintext);
    }

    byte[] encrypt(AiProvider provider, String plaintext) {
        byte[] nonce = new byte[NONCE_BYTES];
        random.nextBytes(nonce);
        try {
            byte[] ciphertext = cipher(Cipher.ENCRYPT_MODE, nonce, provider).doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            return ByteBuffer.allocate(1 + nonce.length + ciphertext.length)
                    .put(FORMAT_VERSION).put(nonce).put(ciphertext).array();
        } catch (GeneralSecurityException ignored) {
            throw unavailable();
        }
    }

    String decrypt(byte[] payload) {
        return decrypt(AiProvider.DEEPSEEK, payload);
    }

    String decrypt(AiProvider provider, byte[] payload) {
        if (payload.length < 1 + NONCE_BYTES + 16 || payload[0] != FORMAT_VERSION) {
            throw unavailable();
        }
        ByteBuffer buffer = ByteBuffer.wrap(payload, 1, payload.length - 1);
        byte[] nonce = new byte[NONCE_BYTES];
        buffer.get(nonce);
        byte[] ciphertext = new byte[buffer.remaining()];
        buffer.get(ciphertext);
        try {
            return new String(cipher(Cipher.DECRYPT_MODE, nonce, provider).doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException ignored) {
            throw unavailable();
        }
    }

    private Cipher cipher(int mode, byte[] nonce, AiProvider provider) throws GeneralSecurityException {
        if (key == null) throw unavailable();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, key, new GCMParameterSpec(128, nonce));
        cipher.updateAAD(("workbench:ai:" + provider.id + ":api-key:v1").getBytes(StandardCharsets.US_ASCII));
        return cipher;
    }

    private ApiException unavailable() {
        return new ApiException(503, "AI_KEY_UNAVAILABLE", "无法使用 AI 凭据。请检查服务器的 AI 加密密钥配置。");
    }
}
