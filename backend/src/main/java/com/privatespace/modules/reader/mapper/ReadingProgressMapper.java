package com.privatespace.modules.reader.mapper;

import com.privatespace.modules.reader.entity.ReadingProgressEntity;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface ReadingProgressMapper {
    String FIELDS = "revision, source_hash AS sourceHash, format, locator, operation, request_hash AS requestHash, CAST(updated_at AS CHAR) AS updatedAt";

    @Select("SELECT " + FIELDS + " FROM reading_progress WHERE file_id=#{id}")
    ReadingProgressEntity find(String id);

    @Insert("INSERT IGNORE INTO reading_progress(file_id) VALUES(#{id})")
    void ensure(String id);

    @Select("SELECT " + FIELDS + " FROM reading_progress WHERE file_id=#{id} FOR UPDATE")
    ReadingProgressEntity lock(String id);

    @Update("UPDATE reading_progress SET revision=revision+1, source_hash=#{sourceHash}, format=#{format}, locator=#{locator}, operation=#{operation}, request_hash=#{requestHash}, updated_at=UTC_TIMESTAMP(6) WHERE file_id=#{id}")
    void save(String id, String sourceHash, String format, String locator, String operation, String requestHash);
}
