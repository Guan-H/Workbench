package com.privatespace.modules.file.mapper;

import java.time.LocalDateTime;
import java.util.List;

import com.privatespace.modules.file.entity.FileObjectEntity;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface FileObjectMapper {
    @Insert("INSERT INTO file_object (id, sha256, size) VALUES (#{id}, #{sha256}, #{size})")
    void insert(FileObjectEntity object);

    @Select("SELECT id, sha256, size FROM file_object WHERE id = #{id}")
    FileObjectEntity find(String id);

    @Insert("INSERT INTO file_object_lease (lease_id, object_id, expires_at) VALUES (#{leaseId}, #{objectId}, #{expiresAt})")
    void lease(String leaseId, String objectId, LocalDateTime expiresAt);

    @Delete("DELETE FROM file_object_lease WHERE lease_id = #{leaseId}")
    int release(String leaseId);

    @Delete("DELETE FROM file_object_lease WHERE expires_at < UTC_TIMESTAMP(6)")
    int releaseExpired();

    @Select("SELECT o.id FROM file_object o WHERE o.created_at < #{cutoff} " +
            "AND NOT EXISTS (SELECT 1 FROM note_file f WHERE f.object_id = o.id) " +
            "AND NOT EXISTS (SELECT 1 FROM note_revision r WHERE r.object_id = o.id) " +
            "AND NOT EXISTS (SELECT 1 FROM file_object_lease l WHERE l.object_id = o.id AND l.expires_at >= UTC_TIMESTAMP(6)) " +
            "ORDER BY o.created_at, o.id LIMIT #{limit}")
    List<String> unreferenced(LocalDateTime cutoff, int limit);

    @Delete("DELETE FROM file_object WHERE id = #{id} " +
            "AND NOT EXISTS (SELECT 1 FROM note_file f WHERE f.object_id = file_object.id) " +
            "AND NOT EXISTS (SELECT 1 FROM note_revision r WHERE r.object_id = file_object.id) " +
            "AND NOT EXISTS (SELECT 1 FROM file_object_lease l WHERE l.object_id = file_object.id AND l.expires_at >= UTC_TIMESTAMP(6))")
    int deleteUnreferenced(String id);
}
