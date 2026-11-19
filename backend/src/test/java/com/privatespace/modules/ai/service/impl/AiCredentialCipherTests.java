package com.privatespace.modules.ai.service.impl;

import com.privatespace.common.exception.ApiException;
import org.junit.jupiter.api.Test;

import java.security.SecureRandom;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AiCredentialCipherTests {
    @Test
    void opensWithTheOriginalKeyAndRejectsTampering() {
        byte[] serverKey = new byte[32];
        new SecureRandom().nextBytes(serverKey);
        String key = Base64.getEncoder().encodeToString(serverKey);
        var cipher = new AiCredentialCipher(key);
        byte[] envelope = cipher.encrypt("fixture-credential");
        assertThat(new AiCredentialCipher(key).decrypt(envelope)).isEqualTo("fixture-credential");
        assertThat(cipher.encrypt("fixture-credential")).isNotEqualTo(envelope);
        envelope[envelope.length - 1] ^= 1;
        assertThatThrownBy(() -> cipher.decrypt(envelope)).isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code()).isEqualTo("AI_KEY_UNAVAILABLE");
    }

    @Test
    void bindsCredentialsToTheConfiguredProvider() {
        byte[] serverKey = new byte[32];
        new SecureRandom().nextBytes(serverKey);
        var cipher = new AiCredentialCipher(Base64.getEncoder().encodeToString(serverKey));
        byte[] envelope = cipher.encrypt(AiProvider.KIMI, "fixture-credential");
        assertThat(cipher.decrypt(AiProvider.KIMI, envelope)).isEqualTo("fixture-credential");
        assertThatThrownBy(() -> cipher.decrypt(AiProvider.OPENAI, envelope)).isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code()).isEqualTo("AI_KEY_UNAVAILABLE");
    }

    @Test
    void bindsNewCiphertextToAnExactConnectionWithoutBreakingLegacyCiphertext() {
        byte[] serverKey = new byte[32];
        new SecureRandom().nextBytes(serverKey);
        var cipher = new AiCredentialCipher(Base64.getEncoder().encodeToString(serverKey));
        byte[] legacy = cipher.encrypt("fixture-legacy");
        byte[] connection = cipher.encrypt(AiProvider.DEEPSEEK, "work", "fixture-work");
        assertThat(cipher.decrypt(AiProvider.DEEPSEEK, "deepseek", legacy)).isEqualTo("fixture-legacy");
        assertThat(cipher.decrypt(AiProvider.DEEPSEEK, "work", connection)).isEqualTo("fixture-work");
        assertThatThrownBy(() -> cipher.decrypt(AiProvider.DEEPSEEK, "other", connection))
                .isInstanceOf(ApiException.class).extracting(error -> ((ApiException) error).code())
                .isEqualTo("AI_KEY_UNAVAILABLE");
    }
}
