package com.privatespace.modules.note.mapper;

import java.util.List;

import com.privatespace.modules.note.entity.NoteFileEntity;
import com.privatespace.modules.note.entity.NoteRevisionEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface NoteMapper {
    String FIELDS = "id, path, type, version, object_id AS objectId, content, deleted, favorite, last_opened_at AS lastOpenedAt, updated_at AS updatedAt, size, sha256";

    @Select("SELECT id FROM notebook_lock WHERE id = 1 FOR UPDATE")
    int lock();

    @Select("SELECT path FROM (SELECT path, COUNT(*) OVER (PARTITION BY path COLLATE utf8mb4_0900_as_ci) AS occurrences FROM JSON_TABLE(#{paths}, '$[*]' COLUMNS(path VARCHAR(512) CHARACTER SET utf8mb4 PATH '$')) AS imported) AS collisions WHERE occurrences > 1")
    List<String> importCollisions(String paths);

    @Select("SELECT " + FIELDS + " FROM note_file WHERE id = #{id}")
    NoteFileEntity find(String id);

    @Select("SELECT " + FIELDS + " FROM note_file WHERE path = #{path}")
    NoteFileEntity byPath(String path);

    @Select("SELECT id, path, type, version, object_id AS objectId, NULL AS content, deleted, favorite, last_opened_at AS lastOpenedAt, updated_at AS updatedAt, size, sha256 FROM note_file ORDER BY id")
    List<NoteFileEntity> moveCatalog();

    @Update("UPDATE note_file SET path = #{path} WHERE id = #{id}")
    void repath(String id, String path);

    @Select("SELECT COALESCE(MAX(sequence_id), 0) FROM note_change")
    long syncCursor();

    @Select("SELECT " + FIELDS + " " + """
            FROM note_file
            WHERE (deleted = #{deleted} OR (#{includeGroups} = TRUE AND deleted = FALSE AND type = 'folder'
                AND EXISTS (SELECT 1 FROM note_delete_member m JOIN note_file f
                    ON f.id = m.file_id AND f.deleted = TRUE AND f.version = m.deleted_version
                    WHERE m.root_id = note_file.id)))
            AND (#{includeGroups} = FALSE OR NOT EXISTS (
                SELECT 1 FROM note_delete_member m JOIN note_file r ON r.id = m.root_id AND r.type = 'folder'
                WHERE m.file_id = note_file.id AND m.root_id <> m.file_id
                    AND note_file.deleted = TRUE AND note_file.version = m.deleted_version))
            AND id > #{cursor} AND (#{query} = '' OR LOCATE(#{query}, path) > 0 OR LOCATE(#{query}, content) > 0)
            ORDER BY id LIMIT 201
            """)
    List<NoteFileEntity> list(boolean deleted, String cursor, String query, boolean includeGroups);

    @Insert("INSERT INTO note_file (id, path, type, version, object_id, content, size, sha256) VALUES (#{id}, #{path}, #{type}, 1, #{objectId}, #{content}, #{size}, #{sha256})")
    void create(NoteFileEntity note);

    @Update("UPDATE note_file SET version = #{version}, object_id = #{objectId}, content = #{content}, size = #{size}, sha256 = #{sha256}, deleted = #{deleted}, updated_at = UTC_TIMESTAMP(6) WHERE id = #{id}")
    void update(String id, long version, String objectId, String content, long size, String sha256, boolean deleted);

    @Insert("INSERT INTO note_revision (file_id, version, object_id, path, deleted) SELECT id, version, object_id, path, deleted FROM note_file WHERE id = #{id}")
    void history(String id);

    @Insert("INSERT INTO note_change (file_id, version, deleted) SELECT id, version, deleted FROM note_file WHERE id = #{id}")
    void change(String id);

    @Select("SELECT file_id AS fileId, version, object_id AS objectId, path, deleted, created_at AS createdAt FROM note_revision WHERE file_id = #{id} ORDER BY version DESC LIMIT 200")
    List<NoteRevisionEntity> historyList(String id);

    @Select("SELECT file_id AS fileId, version, object_id AS objectId, path, deleted, created_at AS createdAt FROM note_revision WHERE file_id = #{id} AND version = #{version}")
    NoteRevisionEntity revision(String id, long version);

    @Select("SELECT file_id AS fileId, version, object_id AS objectId, path, deleted, created_at AS createdAt FROM note_revision WHERE file_id = #{id} AND deleted = FALSE ORDER BY version DESC LIMIT 1")
    NoteRevisionEntity latestLiveRevision(String id);

    @Update("UPDATE note_file SET last_opened_at = UTC_TIMESTAMP(6) WHERE id = #{id}")
    void opened(String id);

    @Update("UPDATE note_file SET favorite = #{favorite} WHERE id = #{id}")
    void favorite(String id, boolean favorite);

    @Select("SELECT COUNT(*) FROM note_file WHERE LEFT(path, CHAR_LENGTH(#{path}) + 1) = CONCAT(#{path}, '/') AND deleted = FALSE")
    int children(String path);

    @Select("SELECT " + FIELDS + " FROM note_file WHERE deleted = FALSE AND (path = #{path} OR LEFT(path, CHAR_LENGTH(#{path}) + 1) = CONCAT(#{path}, '/')) ORDER BY path")
    List<NoteFileEntity> subtree(String path);

    @Insert("INSERT INTO note_delete_member (root_id, root_deleted_version, file_id, before_version, deleted_version, path) VALUES (#{rootId}, #{rootDeletedVersion}, #{fileId}, #{beforeVersion}, #{deletedVersion}, #{path})")
    void deleteMember(com.privatespace.modules.note.entity.DeleteMemberEntity member);

    @Select("SELECT root_id AS rootId, root_deleted_version AS rootDeletedVersion, file_id AS fileId, before_version AS beforeVersion, deleted_version AS deletedVersion, path FROM note_delete_member WHERE root_id = #{id} AND root_deleted_version = #{version} ORDER BY CHAR_LENGTH(path), path")
    List<com.privatespace.modules.note.entity.DeleteMemberEntity> deleteMembers(String id, long version);

    @Select("SELECT COALESCE(MAX(m.root_deleted_version), 0) FROM note_delete_member m JOIN note_file f ON f.id = m.file_id AND f.deleted = TRUE AND f.version = m.deleted_version WHERE m.root_id = #{id}")
    long pendingDeleteBatch(String id);

    @Select("SELECT root_id AS rootId, root_deleted_version AS rootDeletedVersion, file_id AS fileId, before_version AS beforeVersion, deleted_version AS deletedVersion, path FROM note_delete_member WHERE file_id = #{id} AND deleted_version = #{version} ORDER BY root_deleted_version DESC LIMIT 1")
    com.privatespace.modules.note.entity.DeleteMemberEntity containingDeleteBatch(String id, long version);

    @Select("SELECT response_json FROM note_operation WHERE operation_id = #{operation} AND scope = #{scope} AND request_hash = #{hash}")
    String previous(String operation, String scope, String hash);

    @Select("SELECT COUNT(*) FROM note_operation WHERE operation_id = #{operation} AND scope = #{scope}")
    int operationExists(String operation, String scope);

    @Insert("INSERT INTO note_operation (operation_id, scope, request_hash, response_json) VALUES (#{operation}, #{scope}, #{hash}, #{response})")
    void operation(String operation, String scope, String hash, String response);
}
