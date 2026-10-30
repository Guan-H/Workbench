package com.privatespace.modules.note.mapper;

import java.time.LocalDateTime;
import java.util.List;

import com.privatespace.modules.note.entity.DeleteBatchKey;
import com.privatespace.modules.note.entity.RevisionKey;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface RetentionMapper {
    @Select("SELECT DISTINCT m.root_id AS rootId, m.root_deleted_version AS rootDeletedVersion " +
            "FROM note_delete_member m JOIN note_revision r ON r.file_id = m.root_id AND r.version = m.root_deleted_version " +
            "WHERE r.created_at < #{cutoff} ORDER BY m.root_id, m.root_deleted_version LIMIT #{limit}")
    List<DeleteBatchKey> expiredBatches(LocalDateTime cutoff, int limit);

    @Select("SELECT COUNT(*) FROM note_delete_member m JOIN note_file f ON f.id = m.file_id " +
            "WHERE m.root_id = #{rootId} AND m.root_deleted_version = #{version} " +
            "AND f.deleted = TRUE AND f.version = m.deleted_version")
    int pendingMembers(String rootId, long version);

    @Delete("DELETE FROM note_delete_member WHERE root_id = #{rootId} AND root_deleted_version = #{version}")
    int deleteBatch(String rootId, long version);

    @Select("SELECT id FROM note_file WHERE deleted = TRUE AND updated_at < #{cutoff} ORDER BY updated_at, id LIMIT #{limit}")
    List<String> expiredTrash(LocalDateTime cutoff, int limit);

    @Delete("DELETE FROM note_delete_member WHERE file_id = #{id} OR root_id = #{id}")
    int deleteMemberReferences(String id);

    @Delete("DELETE FROM note_revision WHERE file_id = #{id}")
    int deleteFileRevisions(String id);

    @Delete("DELETE FROM note_file WHERE id = #{id} AND deleted = TRUE AND updated_at < #{cutoff}")
    int deleteTrashFile(String id, LocalDateTime cutoff);

    @Select("SELECT r.file_id AS fileId, r.version FROM note_revision r JOIN note_file f ON f.id = r.file_id " +
            "WHERE r.created_at < #{cutoff} AND r.version <> f.version " +
            "AND NOT EXISTS (SELECT 1 FROM note_delete_member m WHERE m.file_id = r.file_id AND m.before_version = r.version) " +
            "AND NOT EXISTS (SELECT 1 FROM note_delete_member m WHERE m.root_id = r.file_id AND m.root_deleted_version = r.version) " +
            "ORDER BY r.created_at, r.file_id, r.version LIMIT #{limit}")
    List<RevisionKey> expiredRevisions(LocalDateTime cutoff, int limit);

    @Delete("DELETE r FROM note_revision r JOIN note_file f ON f.id = r.file_id " +
            "WHERE r.file_id = #{fileId} AND r.version = #{version} AND r.created_at < #{cutoff} AND r.version <> f.version " +
            "AND NOT EXISTS (SELECT 1 FROM note_delete_member m WHERE m.file_id = r.file_id AND m.before_version = r.version) " +
            "AND NOT EXISTS (SELECT 1 FROM note_delete_member m WHERE m.root_id = r.file_id AND m.root_deleted_version = r.version)")
    int deleteRevision(String fileId, long version, LocalDateTime cutoff);
}
