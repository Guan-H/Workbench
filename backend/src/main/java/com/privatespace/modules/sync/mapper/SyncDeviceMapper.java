package com.privatespace.modules.sync.mapper;

import java.util.List;
import com.privatespace.modules.sync.entity.SyncDeviceEntity;
import org.apache.ibatis.annotations.*;

@Mapper
public interface SyncDeviceMapper {
    @Insert("INSERT INTO sync_pairing (code_hash, name, expires_at) VALUES (#{hash}, #{name}, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 5 MINUTE))")
    void pairing(String hash, String name);

    @Select("SELECT name FROM sync_pairing WHERE code_hash = #{hash} AND expires_at > UTC_TIMESTAMP(6) FOR UPDATE")
    String pairName(String hash);

    @Delete("DELETE FROM sync_pairing WHERE code_hash = #{hash}")
    void consume(String hash);

    @Insert("INSERT INTO sync_device (id, name, token_hash) VALUES (#{id}, #{name}, #{hash})")
    void device(String id, String name, String hash);

    @Select("SELECT id FROM sync_device WHERE token_hash = #{hash} AND revoked = FALSE")
    String find(String hash);

    @Update("UPDATE sync_device SET last_seen_at = UTC_TIMESTAMP(6) WHERE id = #{id}")
    void seen(String id);

    @Update("UPDATE sync_device SET revoked = TRUE WHERE id = #{id}")
    int revoke(String id);

    @Select("SELECT id, name, revoked, created_at AS createdAt, last_seen_at AS lastSeenAt FROM sync_device ORDER BY created_at")
    List<SyncDeviceEntity> list();
}
