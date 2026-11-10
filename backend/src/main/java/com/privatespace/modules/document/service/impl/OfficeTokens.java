package com.privatespace.modules.document.service.impl;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.MACVerifier;
import com.privatespace.common.exception.ApiException;
import com.privatespace.config.OfficeProperties;
import org.springframework.stereotype.Component;

/** Standard HS256 JWT signing/verification uses Nimbus; callback data is read from authenticated claims. */
@Component
public class OfficeTokens {
    private final OfficeProperties properties;
    public OfficeTokens(OfficeProperties properties) { this.properties = properties; }
    public String sign(Map<String, Object> claims) {
        try {
            var jwt = new JWSObject(new JWSHeader(JWSAlgorithm.HS256), new Payload(claims));
            jwt.sign(new MACSigner(secret()));
            return jwt.serialize();
        } catch (JOSEException exception) { throw new ApiException(503, "OFFICE_CONFIGURATION", "文档服务签名配置不可用。"); }
    }
    public Map<String, Object> verify(String token) {
        try {
            if (token == null || token.length() > 65536) throw new IllegalArgumentException();
            var jwt = JWSObject.parse(token);
            if (!JWSAlgorithm.HS256.equals(jwt.getHeader().getAlgorithm()) || !jwt.verify(new MACVerifier(secret()))) throw new IllegalArgumentException();
            var claims = jwt.getPayload().toJSONObject();
            if (claims.get("exp") instanceof Number expires && expires.longValue() < java.time.Instant.now().getEpochSecond()) throw new IllegalArgumentException();
            return claims;
        } catch (Exception exception) { throw new ApiException(401, "OFFICE_UNAUTHORIZED", "文档服务凭据无效或已过期。"); }
    }
    private byte[] secret() {
        if (!properties.enabled() || properties.jwtSecret() == null || properties.jwtSecret().length() < 32) throw new ApiException(503, "OFFICE_DISABLED", "文档服务尚未启用，请联系管理员或下载原文件。");
        return properties.jwtSecret().getBytes(StandardCharsets.UTF_8);
    }
}
