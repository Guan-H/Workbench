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

    @Insert("INSERT INTO sync_conflict_feed (device_id,revision,reported_at,scope_version,client_status_json,client_status_at) VALUES (#{device},#{revision},UTC_TIMESTAMP(6),#{scope},#{status},IF(#{status} IS NULL,NULL,UTC_TIMESTAMP(6))) ON DUPLICATE KEY UPDATE client_status_json=IF(VALUES(revision)>=revision,COALESCE(VALUES(client_status_json),client_status_json),client_status_json),client_status_at=IF(VALUES(revision)>=revision AND VALUES(client_status_json) IS NOT NULL,VALUES(client_status_at),client_status_at),reported_at=IF(VALUES(revision)>=revision,VALUES(reported_at),reported_at),scope_version=IF(VALUES(revision)>=revision,VALUES(scope_version),scope_version),revision=GREATEST(revision,VALUES(revision))")
    void updateFeed(String device, long revision, long scope, String status);

    @Select("SELECT revision,DATE_FORMAT(reported_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS reportedAt,scope_version AS scopeVersion,client_status_json AS statusJson,DATE_FORMAT(client_status_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS statusAt FROM sync_conflict_feed WHERE device_id=#{device}")
    Map<String, Object> readFeed(String device);

    @Select("SELECT path,revision,metadata_json AS metadataJson,scope_version AS scopeVersion,reported_at AS reportedAt FROM sync_conflict_status WHERE device_id=#{device} AND active=#{active} AND path > #{after} ORDER BY path LIMIT #{limit}")
    List<ConflictStatusEntity> page(String device, String after, int limit, boolean active);

    @Insert("INSERT INTO sync_conflict_history (device_id,path,revision,metadata_json,scope_version,reported_at) VALUES (#{device},#{path},#{revision},#{metadata},#{scope},UTC_TIMESTAMP(6))")
    void history(String device, String path, long revision, String metadata, long scope);

    @Select("SELECT path,revision,metadata_json AS metadataJson,scope_version AS scopeVersion,reported_at AS reportedAt FROM sync_conflict_history WHERE device_id=#{device} AND (path > #{after} OR (path=#{after} AND revision > #{revision})) ORDER BY path,revision LIMIT #{limit}")
    List<ConflictStatusEntity> historyPage(String device, String after, long revision, int limit);

    @Insert("INSERT INTO sync_activity VALUES (#{device},#{revision},#{status},#{scope},UTC_TIMESTAMP(6))")
    void activity(String device, long revision, String status, long scope);

    @Select("SELECT revision,status_json AS statusJson,scope_version AS scopeVersion,reported_at AS reportedAt FROM sync_activity WHERE device_id=#{device} AND (#{after}=0 OR revision < #{after}) ORDER BY revision DESC LIMIT #{limit}")
    List<com.privatespace.modules.sync.entity.SyncActivityEntity> activityPage(String device, long after, int limit);
}
