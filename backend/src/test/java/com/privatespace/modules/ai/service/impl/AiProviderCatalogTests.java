package com.privatespace.modules.ai.service.impl;

import com.privatespace.common.exception.ApiException;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.net.InetAddress;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AiProviderCatalogTests {
    @Test
    void keepsEquivalentRegistrationsStableAndSeparatesChangedDestinations() {
        var first = registration("Original", "https://GATEWAY.EXAMPLE.COM:443/openai/v1/");
        var renamed = registration("Renamed", "https://gateway.example.com/openai/v1");
        var changed = registration("Original", "https://gateway.example.com/other/v1");
        assertThat(first.baseUrl).isEqualTo("https://gateway.example.com/openai/v1");
        assertThat(first.id).isEqualTo(renamed.id).isNotEqualTo(changed.id).hasSize(24);
    }

    @Test
    void acceptsOnlyNormalizedPublicHttpsDomainConfigurations() {
        for (String input : List.of("http://gateway.example.com/v1", "https://127.0.0.1/v1", "https://[::1]/v1",
                "https://localhost/v1", "https://x.localhost/v1", "https://gateway.example.com:8443/v1",
                "https://user@gateway.example.com/v1", "https://gateway.example.com/v1?token=value",
                "https://gateway.example.com/x/../v1", "https://gateway.example.com/%2f/v1")) {
            assertThatThrownBy(() -> registration("Invalid", input)).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void rejectsNonPublicResolvedAddressesIncludingLoopbackDns() throws Exception {
        for (String address : List.of("127.0.0.1", "10.0.0.3", "100.64.1.2", "169.254.1.1", "172.16.1.2", "192.168.1.2",
                "198.18.1.2", "240.0.0.1", "::1", "::ffff:127.0.0.1", "fd00::1", "fe80::1", "2001:db8::1", "2002::1")) {
            assertThat(PublicAiDnsResolver.isPublic(InetAddress.getByName(address))).as(address).isFalse();
        }
        assertThat(PublicAiDnsResolver.isPublic(InetAddress.getByName("1.1.1.1"))).isTrue();
        assertThat(PublicAiDnsResolver.isPublic(InetAddress.getByName("2606:4700:4700::1111"))).isTrue();
        assertThatThrownBy(() -> new PublicAiDnsResolver().resolve("localhost")).isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code()).isEqualTo("AI_DESTINATION_NOT_PUBLIC");
    }

    private static AiProvider registration(String name, String url) {
        var json = new ObjectMapper();
        String config = json.writeValueAsString(List.of(new AiProviderCatalog.Registration(name, url)));
        return new AiProviderCatalog(json, config).all().get(AiProvider.BUILT_INS.size());
    }
}
