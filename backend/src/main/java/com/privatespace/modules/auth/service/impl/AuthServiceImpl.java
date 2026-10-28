package com.privatespace.modules.auth.service.impl;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.auth.dto.CredentialsRequest;
import com.privatespace.modules.auth.mapper.AuthMapper;
import com.privatespace.modules.auth.service.AuthService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthServiceImpl implements AuthService {
    private final AuthMapper mapper;
    private final PasswordEncoder encoder;
    private final String setupToken;
    private final SecureRandom random = new SecureRandom();

    public AuthServiceImpl(AuthMapper mapper, PasswordEncoder encoder,
            @Value("${private-space.setup-token:}") String setupToken) {
        this.mapper = mapper;
        this.encoder = encoder;
        this.setupToken = setupToken;
    }

    public boolean initialized() { return mapper.account() != null; }
    public String username() { return mapper.account().username(); }

    @Transactional
    public void initialize(CredentialsRequest request) {
        if (initialized()) throw new ApiException(409, "ALREADY_INITIALIZED", "账户已创建，请直接登录。");
        if (setupToken.length() < 32) throw new ApiException(503, "SETUP_NOT_CONFIGURED", "请先在服务器配置一次性初始化凭证。");
        if (request.setupToken() == null || !MessageDigest.isEqual(setupToken.getBytes(StandardCharsets.UTF_8),
                request.setupToken().getBytes(StandardCharsets.UTF_8))) {
            throw new ApiException(403, "FORBIDDEN", "初始化凭证不正确。");
        }
        if (request.password().length() < 12 || request.password().getBytes(StandardCharsets.UTF_8).length > 72) {
            throw new ApiException(400, "INVALID_PASSWORD", "登录口令至少 12 个字符，UTF-8 编码不超过 72 字节。");
        }
        mapper.create(request.username().strip(), encoder.encode(request.password()));
    }

    public String login(CredentialsRequest request, String remoteAddress) {
        String client = hash(remoteAddress);
        if (mapper.blocked(client) > 0) throw new ApiException(429, "RATE_LIMITED", "连续登录失败过多，请在 15 分钟后重试。");
        var account = mapper.account();
        boolean passwordMatches = account != null && encoder.matches(request.password(), account.passwordHash());
        if (!passwordMatches || !account.username().equals(request.username().strip())) {
            mapper.failed(client);
            throw new ApiException(401, "INVALID_CREDENTIALS", "用户名或登录口令不正确。");
        }
        mapper.clearFailures(client);
        byte[] value = new byte[32];
        random.nextBytes(value);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(value);
        mapper.session(hash(token));
        return token;
    }

    public boolean valid(String token) {
        return token != null && token.length() == 43 && mapper.validSession(hash(token)) > 0;
    }

    public void logout(String token) {
        if (token != null) mapper.revoke(hash(token));
    }

    private String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }
}
