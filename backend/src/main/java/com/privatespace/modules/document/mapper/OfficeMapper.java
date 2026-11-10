package com.privatespace.modules.document.mapper;

import com.privatespace.modules.document.entity.OfficeSessionEntity;
import org.apache.ibatis.annotations.*;

@Mapper
public interface OfficeMapper {
    @Delete("DELETE FROM office_session WHERE expires_at < UTC_TIMESTAMP(6) LIMIT 2000") int expire();
    String FIELDS = "id, file_id AS fileId, source_version AS sourceVersion, source_object AS sourceObject, current_version AS currentVersion, source_path AS sourcePath, owner_hash AS ownerHash, state, pending_save AS pendingSave, completed_save AS completedSave, last_digest AS lastDigest, conflict_id AS conflictId, error_code AS errorCode, (expires_at > UTC_TIMESTAMP(6)) AS valid";
    @Select("SELECT " + FIELDS + " FROM office_session WHERE id=#{id}") OfficeSessionEntity find(String id);
    @Select("SELECT " + FIELDS + " FROM office_session WHERE id=#{id} FOR UPDATE") OfficeSessionEntity lock(String id);
    @Insert("INSERT INTO office_session (id,file_id,source_version,source_object,current_version,source_path,owner_hash,expires_at) VALUES (#{id},#{file},#{version},#{object},#{version},#{path},#{owner},DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 12 HOUR))")
    void create(String id, String file, long version, String object, String path, String owner);
    @Update("UPDATE office_session SET pending_save=#{operation}, error_code=NULL WHERE id=#{id}") void pending(String id, String operation);
    @Update("UPDATE office_session SET current_version=#{version}, last_digest=#{digest}, completed_save=pending_save, pending_save=NULL, error_code=NULL, state=#{state} WHERE id=#{id}")
    void saved(String id, long version, String digest, String state);
    @Update("UPDATE office_session SET state='CONFLICT', conflict_id=#{file}, pending_save=NULL, error_code='VERSION_CONFLICT' WHERE id=#{id}") void conflict(String id, String file);
    @Update("UPDATE office_session SET error_code=#{code}, pending_save=NULL WHERE id=#{id}") void failed(String id, String code);
    @Select("SELECT COUNT(*) FROM office_callback_receipt WHERE session_id=#{id} AND digest=#{digest}") int received(String id, String digest);
    @Insert("INSERT INTO office_callback_receipt (session_id,digest) VALUES (#{id},#{digest})") void receipt(String id, String digest);
}
