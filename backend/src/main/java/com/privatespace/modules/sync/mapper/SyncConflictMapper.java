package com.privatespace.modules.sync.mapper;

import java.util.List;
import java.util.Map;
import com.privatespace.modules.sync.entity.ConflictStatusEntity;
import org.apache.ibatis.annotations.*;

@Mapper
public interface SyncConflictMapper {
    @Select("SELECT path, revision, metadata_json AS metadataJson, scope_version AS scopeVersion, reported_at AS reportedAt FROM sync_conflict_status WHERE device_id=#{device} AND path=#{path}")
    ConflictStatusEntity item(String device, String path);

    @Insert("INSERT INTO sync_conflict_status (device_id,path,revision,active,metadata_json,scope_version,reported_at) VALUES (#{device},#{path},#{revision},#{active},#{metadata},#{scope},UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE revision=VALUES(revision),active=VALUES(active),metadata_json=VALUES(metadata_json),scope_version=VALUES(scope_version),reported_at=VALUES(reported_at)")
    void save(String device, String path, long revision, boolean active, String metadata, long scope);

    @Insert("INSERT INTO sync_conflict_feed VALUES (#{device},#{revision},UTC_TIMESTAMP(6),#{scope}) ON DUPLICATE KEY UPDATE revision=GREATEST(revision,VALUES(revision)),reported_at=VALUES(reported_at),scope_version=VALUES(scope_version)")
    void updateFeed(String device, long revision, long scope);

    @Select("SELECT revision,DATE_FORMAT(reported_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS reportedAt,scope_version AS scopeVersion FROM sync_conflict_feed WHERE device_id=#{device}")
    Map<String, Object> readFeed(String device);

    @Select("SELECT path,revision,metadata_json AS metadataJson,scope_version AS scopeVersion,reported_at AS reportedAt FROM sync_conflict_status WHERE device_id=#{device} AND active=TRUE AND path > #{after} ORDER BY path LIMIT #{limit}")
    List<ConflictStatusEntity> page(String device, String after, int limit);
}
