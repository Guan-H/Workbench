package com.privatespace.modules.file.mapper;

import com.privatespace.modules.file.entity.FileObjectEntity;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface FileObjectMapper {
    @Insert("INSERT INTO file_object (id, sha256, size) VALUES (#{id}, #{sha256}, #{size})")
    void insert(FileObjectEntity object);

    @Select("SELECT id, sha256, size FROM file_object WHERE id = #{id}")
    FileObjectEntity find(String id);
}
