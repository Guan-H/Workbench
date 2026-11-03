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
import com.privatespace.modules.sync.dto.SyncScope;
import com.privatespace.modules.note.service.NoteService;
import com.privatespace.modules.note.dto.NoteResponse;
import com.privatespace.modules.note.dto.SyncWriteRequest;
import tools.jackson.databind.ObjectMapper;

@Service
public class SyncDeviceServiceImpl implements SyncDeviceService {
    private final SyncDeviceMapper mapper;
    private final NoteService notes;
    private final ObjectMapper json;
    private final SecureRandom random = new SecureRandom();

    public SyncDeviceServiceImpl(SyncDeviceMapper mapper, NoteService notes, ObjectMapper json) { this.mapper = mapper; this.notes = notes; this.json = json; }

    public Map<String, String> pairing(String name) {
        return pairing(name, SyncScope.entireLibrary());
    }

    public Map<String, String> pairing(String name, SyncScope scope) {
        if (name == null || name.isBlank() || name.length() > 80) throw new ApiException(400, "INVALID_REQUEST", "设备名称须为 1–80 个字符。");
        String code = secret();
        mapper.pairing(hash(code), name.strip(), json.writeValueAsString(normalize(scope)));
        return Map.of("code", code, "expiresInSeconds", "300");
    }

    @Transactional
    public Map<String, String> pair(String code) {
        if (code == null || code.length() != 43) invalidPair();
        String name = mapper.pairName(hash(code));
        if (name == null) invalidPair();
        String scope = mapper.pairingScope(hash(code));
        normalize(decode(scope));
        mapper.consume(hash(code));
        String id = UUID.randomUUID().toString();
        String token = secret();
        mapper.device(id, name, hash(token), scope);
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
                device.lastSeenAt() == null ? null : device.lastSeenAt().atOffset(java.time.ZoneOffset.UTC).toString(),
                decode(device.scopeJson()), Long.toString(device.scopeVersion()))).toList();
    }

    @Transactional
    public SyncDeviceResponse current(String id) {
        var device = mapper.locked(UUID.fromString(id).toString());
        if (device == null || device.revoked()) throw new ApiException(401, "DEVICE_UNAUTHORIZED", "设备未授权或已被撤销。");
        return new SyncDeviceResponse(device.id(), device.name(), device.revoked(), device.createdAt().atOffset(java.time.ZoneOffset.UTC).toString(),
                device.lastSeenAt() == null ? null : device.lastSeenAt().atOffset(java.time.ZoneOffset.UTC).toString(), decode(device.scopeJson()), Long.toString(device.scopeVersion()));
    }

    @Transactional
    public SyncDeviceResponse updateScope(String id, SyncScope scope, String version) {
        var current = current(id);
        if (!current.scopeVersion().equals(version)) throw new ApiException(409, "SCOPE_VERSION_CONFLICT", "同步范围已被修改，请刷新后重试。");
        var normalized = normalize(scope);
        if (!normalized.equals(current.scope())) mapper.scope(id, json.writeValueAsString(normalized), Long.parseLong(version));
        return current(id);
    }

    @Transactional
    public Map<String, Object> snapshot(String deviceId) {
        var device = current(deviceId);
        var result = new java.util.LinkedHashMap<>(notes.syncSnapshot(device.scope().all() ? List.of() : device.scope().folders()));
        result.put("scope", device.scope());
        result.put("scopeVersion", device.scopeVersion());
        result.put("fileRenameSupported", true);
        return result;
    }

    @Transactional
    public byte[] readFile(String deviceId, String scopeVersion, String id, String version) {
        var device = current(deviceId);
        checkVersion(device, scopeVersion);
        checkPath(device, notes.read(id, false).path(), false);
        return notes.syncRead(id, version);
    }

    @Transactional
    public NoteResponse writeFile(String deviceId, String scopeVersion, SyncWriteRequest request, String operation) {
        var device = current(deviceId);
        checkVersion(device, scopeVersion);
        checkPath(device, request.path(), request.deleted());
        return notes.syncWrite(request, operation, deviceId);
    }

    @Transactional
    public NoteResponse renameFile(String deviceId, String scopeVersion,
            com.privatespace.modules.note.dto.SyncRenameRequest request, String operation) {
        var device = current(deviceId);
        checkVersion(device, scopeVersion);
        // Relocation cannot rename shared attachments outside explicitly selected folders.
        checkPath(device, request.sourcePath(), true);
        checkPath(device, request.targetPath(), true);
        return notes.syncRename(request, operation, deviceId);
    }

    private void checkVersion(SyncDeviceResponse device, String version) {
        if (version == null && device.scope().all() && device.scopeVersion().equals("1")) return;
        if (!device.scopeVersion().equals(version)) throw new ApiException(409, "SYNC_SCOPE_CHANGED", "同步范围已变化，请使用新版助手重新读取范围后对账。");
    }

    private void checkPath(SyncDeviceResponse device, String path, boolean deleted) {
        if (device.scope().all() || device.scope().folders().stream().anyMatch(root -> path.startsWith(root + "/"))) return;
        var snapshot = notes.syncSnapshot(device.scope().folders());
        Object paths = snapshot.get("attachmentPaths");
        if (!deleted && paths instanceof List<?> references && references.contains(path)) return;
        throw new ApiException(403, "OUTSIDE_SYNC_SCOPE", "文件不在设备同步范围内；目录外引用附件不通过本地缺失传播删除。");
    }

    private SyncScope normalize(SyncScope scope) {
        if (scope == null) return SyncScope.entireLibrary();
        if (scope.all()) {
            if (scope.folders() != null && !scope.folders().isEmpty()) throw new ApiException(400, "INVALID_SCOPE", "全部同步不能同时指定文件夹。");
            return SyncScope.entireLibrary();
        }
        return new SyncScope(false, notes.validateSyncFolders(scope.folders()));
    }

    private SyncScope decode(String scope) {
        return scope == null ? SyncScope.entireLibrary() : json.readValue(scope, SyncScope.class);
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
