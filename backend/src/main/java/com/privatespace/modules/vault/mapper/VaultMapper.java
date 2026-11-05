package com.privatespace.modules.vault.mapper;

import com.privatespace.modules.vault.entity.VaultSnapshotEntity;
import com.privatespace.modules.vault.entity.VaultOperationEntity;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface VaultMapper {
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
