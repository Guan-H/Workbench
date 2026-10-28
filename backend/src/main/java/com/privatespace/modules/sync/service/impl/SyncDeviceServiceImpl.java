package com.privatespace.modules.sync.service.impl;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.sync.mapper.SyncDeviceMapper;
import com.privatespace.modules.sync.service.SyncDeviceService;
import com.privatespace.modules.sync.dto.SyncDeviceResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SyncDeviceServiceImpl implements SyncDeviceService {
    private final SyncDeviceMapper mapper;
    private final SecureRandom random = new SecureRandom();

    public SyncDeviceServiceImpl(SyncDeviceMapper mapper) { this.mapper = mapper; }

    public Map<String, String> pairing(String name) {
        if (name == null || name.isBlank() || name.length() > 80) throw new ApiException(400, "INVALID_REQUEST", "设备名称须为 1–80 个字符。");
        String code = secret();
        mapper.pairing(hash(code), name.strip());
        return Map.of("code", code, "expiresInSeconds", "300");
    }

    @Transactional
    public Map<String, String> pair(String code) {
        if (code == null || code.length() != 43) invalidPair();
        String name = mapper.pairName(hash(code));
        if (name == null) invalidPair();
        mapper.consume(hash(code));
        String id = UUID.randomUUID().toString();
        String token = secret();
        mapper.device(id, name, hash(token));
        return Map.of("id", id, "token", token, "name", name);
    }

    public String authenticate(String token) {
        if (token == null || token.length() != 43) return null;
        String id = mapper.find(hash(token));
        if (id != null) mapper.seen(id);
        return id;
    }

    public List<SyncDeviceResponse> list() {
        return mapper.list().stream().map(device -> new SyncDeviceResponse(device.id(), device.name(), device.revoked(),
                device.createdAt().atOffset(java.time.ZoneOffset.UTC).toString(),
                device.lastSeenAt() == null ? null : device.lastSeenAt().atOffset(java.time.ZoneOffset.UTC).toString())).toList();
    }
    public void revoke(String id) {
        if (mapper.revoke(UUID.fromString(id).toString()) == 0) throw new ApiException(404, "NOT_FOUND", "设备不存在。");
    }
    private void invalidPair() { throw new ApiException(401, "INVALID_PAIRING", "配对码无效、已使用或已过期。"); }
    private String secret() { byte[] bytes = new byte[32]; random.nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    private String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }
}
