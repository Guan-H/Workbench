package com.privatespace.modules.sync.mapper;

import java.util.List;
import com.privatespace.modules.sync.entity.SyncDeviceEntity;
import org.apache.ibatis.annotations.*;

@Mapper
public interface SyncDeviceMapper {
    @Insert("INSERT INTO sync_pairing (code_hash, name, expires_at, scope_json) VALUES (#{hash}, #{name}, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 5 MINUTE), #{scope})")
    void pairing(String hash, String name, String scope);

    @Select("SELECT name FROM sync_pairing WHERE code_hash = #{hash} AND expires_at > UTC_TIMESTAMP(6) FOR UPDATE")
    String pairName(String hash);

    @Select("SELECT scope_json FROM sync_pairing WHERE code_hash = #{hash}")
    String pairingScope(String hash);

    @Delete("DELETE FROM sync_pairing WHERE code_hash = #{hash}")
    void consume(String hash);

    @Insert("INSERT INTO sync_device (id, name, token_hash, scope_json) VALUES (#{id}, #{name}, #{hash}, #{scope})")
    void device(String id, String name, String hash, String scope);

    @Select("SELECT id FROM sync_device WHERE token_hash = #{hash} AND revoked = FALSE")
    String find(String hash);

    @Update("UPDATE sync_device SET last_seen_at = UTC_TIMESTAMP(6) WHERE id = #{id}")
    void seen(String id);

    @Update("UPDATE sync_device SET revoked = TRUE WHERE id = #{id}")
    int revoke(String id);

    @Select("SELECT id, name, revoked, created_at AS createdAt, last_seen_at AS lastSeenAt, scope_json AS scopeJson, scope_version AS scopeVersion FROM sync_device ORDER BY created_at, id")
    List<SyncDeviceEntity> list();

    @Select("SELECT id, name, revoked, created_at AS createdAt, last_seen_at AS lastSeenAt, scope_json AS scopeJson, scope_version AS scopeVersion FROM sync_device WHERE id = #{id} FOR UPDATE")
    SyncDeviceEntity locked(String id);

    @Update("UPDATE sync_device SET scope_json = #{scope}, scope_version = scope_version + 1 WHERE id = #{id} AND scope_version = #{version} AND revoked = FALSE")
    int scope(String id, String scope, long version);

    @Update("UPDATE sync_device SET attachment_paths_json = #{paths}, snapshot_scope_version = scope_version WHERE id = #{id}")
    void saveSnapshotPaths(String id, String paths);

    @Select("SELECT attachment_paths_json FROM sync_device WHERE id = #{id} AND snapshot_scope_version = scope_version")
    String readSnapshotPaths(String id);
}
