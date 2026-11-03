package com.privatespace.modules.sync.mapper;

import java.util.List;
import com.privatespace.modules.sync.entity.SyncSnapshotEntity;
import com.privatespace.modules.sync.entity.SyncSnapshotItemEntity;
import org.apache.ibatis.annotations.*;

@Mapper
public interface SyncSnapshotMapper {
    @Delete("DELETE FROM sync_snapshot WHERE device_id = #{device} OR expires_at <= UTC_TIMESTAMP(6)")
    void discard(String device);

    @Insert("INSERT INTO sync_snapshot (id, device_id, scope_version, metadata_json, item_count, expires_at) VALUES (#{id}, #{device}, #{version}, #{metadata}, #{count}, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 HOUR))")
    void create(String id, String device, long version, String metadata, long count);

    @Insert("<script>INSERT INTO sync_snapshot_item (snapshot_id, position, metadata_json) VALUES <foreach collection='items' item='item' separator=','>(#{id}, #{item.position}, #{item.metadataJson})</foreach></script>")
    void append(String id, List<SyncSnapshotItemEntity> items);

    @Select("SELECT id, scope_version AS scopeVersion, metadata_json AS metadataJson, item_count AS itemCount FROM sync_snapshot WHERE id = #{id} AND device_id = #{device} AND expires_at > UTC_TIMESTAMP(6)")
    SyncSnapshotEntity find(String id, String device);

    @Select("SELECT metadata_json FROM sync_snapshot_item WHERE snapshot_id = #{id} AND position > #{after} ORDER BY position LIMIT #{limit}")
    List<String> page(String id, long after, int limit);
}
