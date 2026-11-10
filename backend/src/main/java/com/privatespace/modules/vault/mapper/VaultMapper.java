package com.privatespace.modules.vault.mapper;

import com.privatespace.modules.vault.entity.VaultSnapshotEntity;
import com.privatespace.modules.vault.entity.VaultOperationEntity;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import org.apache.ibatis.annotations.Delete;
import java.util.List;
import com.privatespace.modules.vault.entity.VaultHistoryEntity;

@Mapper
public interface VaultMapper {
    @Select("SELECT envelope FROM vault_recovery_key WHERE vault_id = #{id}")
    String recovery(String id);

    @Insert("INSERT INTO vault_recovery_key (vault_id, recovery_id, envelope) VALUES (#{vaultId}, #{id}, #{envelope}) ON DUPLICATE KEY UPDATE recovery_id = #{id}, envelope = #{envelope}, updated_at = UTC_TIMESTAMP(6)")
    void saveRecovery(String vaultId, String id, String envelope);

    @Select("SELECT version, DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt, operation_kind AS operationKind FROM vault_snapshot_history WHERE vault_id = #{id} AND version <= #{anchor} ORDER BY version DESC LIMIT 10 OFFSET #{offset}")
    List<VaultHistoryEntity> history(String id, long anchor, long offset);

    @Select("SELECT COUNT(*) FROM vault_snapshot_history WHERE vault_id = #{id} AND version <= #{anchor}")
    long historyCount(String id, long anchor);

    @Select("SELECT envelope FROM vault_snapshot_history WHERE vault_id = #{id} AND version = #{version}")
    String historyEnvelope(String id, long version);

    @Select("SELECT DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') FROM vault_snapshot_history WHERE vault_id = #{id} AND version = #{version}")
    String historyCreatedAt(String id, long version);

    // Account lock serializes pruning with every snapshot write; never delete the current version.
    @Delete("DELETE FROM vault_snapshot_history WHERE vault_id = #{id} AND version < #{currentVersion} AND created_at < #{cutoff} LIMIT 2000")
    int pruneHistory(String id, long currentVersion, java.time.LocalDateTime cutoff);
    @Select("SELECT id FROM account WHERE id = 1 FOR UPDATE")
    int lockAccount();

    @Select("SELECT vault_id AS vaultId, version, envelope, creation_operation AS creationOperation, DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt FROM vault_snapshot WHERE account_id = 1")
    VaultSnapshotEntity snapshot();

    @Insert("INSERT INTO vault_snapshot (account_id, vault_id, version, envelope, creation_operation) VALUES (1, #{id}, 1, #{envelope}, #{operation})")
    void create(String id, String envelope, String operation);

    @Insert("INSERT INTO vault_snapshot_history (vault_id, version, envelope) VALUES (#{id}, 1, #{envelope})")
    void createHistory(String id, String envelope);

    @Select("SELECT vault_id AS vaultId, version, base_version AS baseVersion, envelope, operation_kind AS operationKind FROM vault_snapshot_history WHERE operation_id = #{operation}")
    VaultOperationEntity operation(String operation);

    @Update("UPDATE vault_snapshot SET version = version + 1, envelope = #{envelope} WHERE account_id = 1 AND vault_id = #{id} AND version = #{baseVersion}")
    int replaceSnapshot(String id, long baseVersion, String envelope);

    @Insert("INSERT INTO vault_snapshot_history (vault_id, version, base_version, envelope, operation_id, operation_kind) VALUES (#{id}, #{version}, #{baseVersion}, #{envelope}, #{operation}, #{kind})")
    void appendHistory(String id, long version, long baseVersion, String envelope, String operation, String kind);
}
