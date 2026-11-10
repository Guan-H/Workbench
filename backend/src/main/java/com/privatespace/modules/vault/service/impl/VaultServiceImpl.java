package com.privatespace.modules.vault.service.impl;

import java.util.UUID;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.vault.dto.CreateVaultRequest;
import com.privatespace.modules.vault.dto.ChangeVaultMasterPasswordRequest;
import com.privatespace.modules.vault.dto.UpdateVaultRequest;
import com.privatespace.modules.vault.dto.VaultResponse;
import com.privatespace.modules.vault.dto.VaultHistoryPage;
import com.privatespace.modules.vault.dto.VaultRecoveryResponse;
import com.privatespace.modules.vault.dto.ConfigureVaultRecoveryRequest;
import com.privatespace.modules.vault.dto.ResetVaultMasterRequest;
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

    @Transactional(readOnly = true)
    public VaultRecoveryResponse recovery() {
        var saved = mapper.snapshot();
        if (saved == null) throw new ApiException(404, "VAULT_NOT_FOUND", "保险库尚未创建。");
        String recovery = mapper.recovery(saved.vaultId());
        return new VaultRecoveryResponse(recovery != null, Long.toString(saved.version()),
                recovery == null ? null : json.readTree(recovery));
    }

    /** Setup bumps the vault version so stale setup/reset confirmations cannot silently overwrite it. */
    @Transactional
    public VaultResponse configureRecovery(ConfigureVaultRecoveryRequest request, String operation) {
        validateOperation(operation);
        validator.validate(request.envelope());
        String id = validator.validateRecovery(request.recovery(), request.envelope());
        mapper.lockAccount();
        String value = json.writeValueAsString(request.recovery());
        String existing = mapper.recovery(request.envelope().path("vaultId").asText());
        var previous = mapper.operation(operation);
        if (previous != null && !value.equals(existing)) throw conflict();
        if (previous == null && existing != null && id.equals(json.readTree(existing).path("id").asText())) {
            throw new ApiException(400, "INVALID_RECOVERY_KEY", "重新生成须使用新的恢复密钥标识。");
        }
        var result = update(request.baseVersion(), request.envelope(), operation, "recovery-key");
        if (previous == null) mapper.saveRecovery(result.vaultId(), id, value);
        return result;
    }

    @Transactional
    public VaultResponse resetMaster(ResetVaultMasterRequest request, String operation) {
        mapper.lockAccount();
        var saved = mapper.snapshot();
        String recovery = saved == null ? null : mapper.recovery(saved.vaultId());
        if (recovery == null || !request.recoveryId().equals(json.readTree(recovery).path("id").asText())) {
            throw new ApiException(409, "VAULT_RECOVERY_CHANGED", "恢复密钥尚未启用或已更换，请重新读取；原数据未被本次请求改动。");
        }
        return update(request.baseVersion(), request.envelope(), operation, "recovery-reset");
    }

    public VaultResponse read() {
        var saved = mapper.snapshot();
        return saved == null ? VaultResponse.empty() : new VaultResponse(true, saved.vaultId(),
                Long.toString(saved.version()), json.readTree(saved.envelope()), saved.createdAt());
    }

    @Override
    @Transactional(readOnly = true)
    public VaultHistoryPage history(int page, String anchor) {
        if (page < 1) throw new ApiException(400, "INVALID_VAULT_PAGE", "历史页码不正确。");
        var saved = mapper.snapshot();
        if (saved == null) throw new ApiException(404, "VAULT_NOT_FOUND", "保险库尚未创建。");
        long upper = anchor == null ? saved.version() : parseVersion(anchor);
        if (upper > saved.version()) throw new ApiException(400, "INVALID_VAULT_VERSION", "历史版本范围不正确。");
        var items = mapper.history(saved.vaultId(), upper, (page - 1L) * 10).stream()
                .map(row -> new VaultHistoryPage.Item(Long.toString(row.version()), row.createdAt(), row.operationKind())).toList();
        return new VaultHistoryPage(items, mapper.historyCount(saved.vaultId(), upper), page, 10, Long.toString(upper), Long.toString(saved.version()));
    }

    @Override
    @Transactional(readOnly = true)
    public VaultResponse historical(String version) {
        long number = parseVersion(version);
        var saved = mapper.snapshot();
        if (saved == null) throw new ApiException(404, "VAULT_NOT_FOUND", "保险库尚未创建。");
        String envelope = mapper.historyEnvelope(saved.vaultId(), number);
        if (envelope == null) throw new ApiException(404, "VAULT_HISTORY_NOT_FOUND", "该历史版本不存在或已按保留策略清理，请刷新历史列表。");
        return new VaultResponse(true, saved.vaultId(), Long.toString(number), json.readTree(envelope), mapper.historyCreatedAt(saved.vaultId(), number));
    }

    private long parseVersion(String value) {
        try {
            long parsed = Long.parseLong(value);
            if (parsed < 1 || !Long.toString(parsed).equals(value)) throw new NumberFormatException();
            return parsed;
        } catch (NumberFormatException exception) {
            throw new ApiException(400, "INVALID_VAULT_VERSION", "保险库版本不正确。");
        }
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
        if (("master-password".equals(kind) || "recovery-reset".equals(kind)) && (!original.get("payload").equals(changed.get("payload"))
                || original.path("kdf").get("salt").equals(changed.path("kdf").get("salt"))
                || original.path("wrappedKey").get("nonce").equals(changed.path("wrappedKey").get("nonce"))
                || original.path("wrappedKey").get("ciphertext").equals(changed.path("wrappedKey").get("ciphertext")))) {
            throw new ApiException(400, "INVALID_KEY_REWRAP", "主密码修改只能替换密钥包装，不能修改已有内容。");
        }
        if ("recovery-key".equals(kind) && !original.equals(changed)) {
            throw new ApiException(400, "INVALID_RECOVERY_SETUP", "启用恢复密钥不能修改保险库内容或主密码。");
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
