package com.privatespace.modules.settings.mapper;

import org.apache.ibatis.annotations.*;

@Mapper
public interface AppearanceMapper {
    @Select("SELECT version FROM workspace_appearance WHERE id=1 FOR UPDATE") long lock();
    @Select("SELECT version FROM workspace_appearance WHERE id=1") long version();
    @Select("SELECT settings FROM workspace_appearance WHERE id=1") String settings();
    @Update("UPDATE workspace_appearance SET settings=#{json},version=version+1 WHERE id=1") void save(String json);
    @Insert("INSERT INTO workspace_background(id,image) VALUES(#{id},#{image})") void insertImage(String id, byte[] image);
    record Background(String id, byte[] image) {}
    @Select("SELECT id,image FROM workspace_background WHERE id=#{id}") Background image(String id);
    @Select("SELECT COUNT(*) FROM workspace_background") int count();
    @Select("SELECT id FROM workspace_background ORDER BY created_at DESC,id") java.util.List<String> listImages();
}
