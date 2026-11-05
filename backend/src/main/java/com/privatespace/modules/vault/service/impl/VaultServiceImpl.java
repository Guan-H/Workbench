package com.privatespace.modules.vault.service.impl;

import java.util.UUID;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.vault.dto.CreateVaultRequest;
import com.privatespace.modules.vault.dto.ChangeVaultMasterPasswordRequest;
import com.privatespace.modules.vault.dto.UpdateVaultRequest;
import com.privatespace.modules.vault.dto.VaultResponse;
import com.privatespace.modules.vault.mapper.VaultMapper;
import com.privatespace.modules.vault.service.VaultService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.JsonNode;

/** Stores opaque vault snapshots with conditional, atomic history writes. */
@Service
public class VaultServiceImpl implements VaultService {
    private final VaultMapper mapper;
    private final VaultEnvelopeValidator validator;
    private final ObjectMapper json;

    public VaultServiceImpl(VaultMapper mapper, VaultEnvelopeValidator validator, ObjectMapper json) {
        this.mapper = mapper;
        this.validator = validator;
        this.json = json;
    }

    public VaultResponse read() {
        var saved = mapper.snapshot();
        return saved == null ? VaultResponse.empty() : new VaultResponse(true, saved.vaultId(),
                Long.toString(saved.version()), json.readTree(saved.envelope()), saved.createdAt());
    }

    @Transactional
    public VaultResponse create(CreateVaultRequest request, String operation) {
        validateOperation(operation);
        String id = validator.validate(request.envelope());
        String envelope = json.writeValueAsString(request.envelope());
        mapper.lockAccount();
        var saved = mapper.snapshot();
        if (saved != null) {
            if (saved.creationOperation().equals(operation) && saved.envelope().equals(envelope)) return read();
            throw new ApiException(409, "VAULT_EXISTS", "保险库已存在，请刷新并解锁；不会覆盖原数据。");
        }
        mapper.create(id, envelope, operation);
        mapper.createHistory(id, envelope);
        return read();
    }

    /** The snapshot and history either both commit, or neither does. Stale retries cannot report old success. */
    @Transactional
    public VaultResponse changeMasterPassword(ChangeVaultMasterPasswordRequest request, String operation) {
        return update(request.baseVersion(), request.envelope(), operation, "master-password");
    }

    @Transactional
    public VaultResponse save(UpdateVaultRequest request, String operation) {
        return update(request.baseVersion(), request.envelope(), operation, "content");
    }

    private VaultResponse update(String expectedVersion, JsonNode changed, String operation, String kind) {
        validateOperation(operation);
        long baseVersion;
        try {
            baseVersion = Long.parseLong(expectedVersion);
            if (baseVersion < 1 || baseVersion == Long.MAX_VALUE) throw new NumberFormatException();
        } catch (NumberFormatException exception) {
            throw new ApiException(400, "INVALID_VAULT_VERSION", "保险库版本不正确，请重新读取。");
        }
        String id = validator.validate(changed);
        String envelope = json.writeValueAsString(changed);
        mapper.lockAccount();
        var saved = mapper.snapshot();
        if (saved == null) throw new ApiException(404, "VAULT_NOT_FOUND", "保险库尚未创建。");
        var previous = mapper.operation(operation);
        if (previous != null) {
            if (kind.equals(previous.operationKind()) && previous.vaultId().equals(id) && previous.baseVersion() == baseVersion
                    && previous.envelope().equals(envelope) && previous.version() == saved.version()
                    && saved.envelope().equals(envelope)) return read();
            throw conflict();
        }
        if (saved.creationOperation().equals(operation) || saved.version() != baseVersion) throw conflict();
        var original = json.readTree(saved.envelope());
        if (!saved.vaultId().equals(id) || !original.get("keyId").equals(changed.get("keyId"))) {
            throw new ApiException(400, "INVALID_VAULT_IDENTITY", "不能修改保险库或数据密钥标识。");
        }
        // Content saves cannot rewrap keys, and master-password changes cannot replace content.
        if ("master-password".equals(kind) && (!original.get("payload").equals(changed.get("payload"))
                || original.path("kdf").get("salt").equals(changed.path("kdf").get("salt"))
                || original.path("wrappedKey").get("nonce").equals(changed.path("wrappedKey").get("nonce"))
                || original.path("wrappedKey").get("ciphertext").equals(changed.path("wrappedKey").get("ciphertext")))) {
            throw new ApiException(400, "INVALID_KEY_REWRAP", "主密码修改只能替换密钥包装，不能修改已有内容。");
        }
        if ("content".equals(kind) && (!original.get("kdf").equals(changed.get("kdf"))
                || !original.get("wrappedKey").equals(changed.get("wrappedKey"))
                || original.path("payload").get("id").equals(changed.path("payload").get("id"))
                || original.path("payload").get("nonce").equals(changed.path("payload").get("nonce")))) {
            throw new ApiException(400, "INVALID_VAULT_UPDATE", "条目保存只能替换加密内容，并需生成新快照标识和 nonce。");
        }
        if (mapper.replaceSnapshot(id, baseVersion, envelope) != 1) throw conflict();
        mapper.appendHistory(id, baseVersion + 1, baseVersion, envelope, operation, kind);
        return read();
    }

    private ApiException conflict() {
        return new ApiException(409, "VAULT_VERSION_CONFLICT", "保险库版本已变化或操作标识已使用，请核对最新版本后重试；本次未覆盖已有数据。");
    }

    private void validateOperation(String operation) {
        try {
            if (!UUID.fromString(operation).toString().equals(operation)) throw new IllegalArgumentException();
        } catch (IllegalArgumentException exception) {
            throw new ApiException(400, "INVALID_OPERATION", "操作标识不正确，请重试。");
        }
    }
}
