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

    @Select("SELECT " + FIELDS + " FROM note_file WHERE deleted = #{deleted} AND id > #{cursor} AND (#{query} = '' OR LOCATE(#{query}, path) > 0 OR LOCATE(#{query}, content) > 0) ORDER BY id LIMIT 201")
    List<NoteFileEntity> list(boolean deleted, String cursor, String query);

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

    @Update("UPDATE note_file SET last_opened_at = UTC_TIMESTAMP(6) WHERE id = #{id}")
    void opened(String id);

    @Update("UPDATE note_file SET favorite = #{favorite} WHERE id = #{id}")
    void favorite(String id, boolean favorite);

    @Select("SELECT COUNT(*) FROM note_file WHERE LEFT(path, CHAR_LENGTH(#{path}) + 1) = CONCAT(#{path}, '/') AND deleted = FALSE")
    int children(String path);

    @Select("SELECT response_json FROM note_operation WHERE operation_id = #{operation} AND scope = #{scope} AND request_hash = #{hash}")
    String previous(String operation, String scope, String hash);

    @Select("SELECT COUNT(*) FROM note_operation WHERE operation_id = #{operation} AND scope = #{scope}")
    int operationExists(String operation, String scope);

    @Insert("INSERT INTO note_operation (operation_id, scope, request_hash, response_json) VALUES (#{operation}, #{scope}, #{hash}, #{response})")
    void operation(String operation, String scope, String hash, String response);
}
