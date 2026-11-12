package com.privatespace.modules.mindmap.mapper;

import java.util.List;
import com.privatespace.modules.mindmap.entity.MindmapEntity;
import org.apache.ibatis.annotations.*;

@Mapper
public interface MindmapMapper {
    @Select("SELECT id FROM mind_map_lock WHERE id=1 FOR UPDATE") int lock();
    @Select("SELECT id,title,version,document,deleted,updated_at AS updatedAt FROM mind_map WHERE id=#{id}") MindmapEntity find(String id);
    @Select("SELECT id,title,version,NULL AS document,deleted,updated_at AS updatedAt FROM mind_map WHERE deleted=#{deleted} AND title LIKE CONCAT('%',#{query},'%') ORDER BY updated_at DESC,id LIMIT 10 OFFSET #{offset}")
    List<MindmapEntity> list(boolean deleted, String query, int offset);
    @Select("SELECT COUNT(*) FROM mind_map WHERE deleted=#{deleted} AND title LIKE CONCAT('%',#{query},'%')") long total(boolean deleted, String query);
    @Insert("INSERT INTO mind_map(id,title,version,document) VALUES(#{id},#{title},1,#{document})") void create(String id, String title, String document);
    @Update("UPDATE mind_map SET title=#{title},document=#{document},version=version+1,updated_at=UTC_TIMESTAMP(6) WHERE id=#{id}") void save(String id, String title, String document);
    @Update("UPDATE mind_map SET deleted=#{deleted},version=version+1,updated_at=UTC_TIMESTAMP(6) WHERE id=#{id}") void deleted(String id, boolean deleted);
    @Select("SELECT request_hash FROM mind_map_operation WHERE operation=#{operation}") String operationHash(String operation);
    @Select("SELECT result FROM mind_map_operation WHERE operation=#{operation}") String operationResult(String operation);
    @Insert("INSERT INTO mind_map_operation(operation,request_hash,result) VALUES(#{operation},#{hash},#{result})") void receipt(String operation, String hash, String result);
}
