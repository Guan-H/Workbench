package com.privatespace.modules.english.mapper;

import java.util.List;
import org.apache.ibatis.annotations.*;
import com.privatespace.modules.english.entity.*;

@Mapper
public interface CourseMapper {
    String FIELDS = "c.id,c.title,c.focus,c.source,c.payload,c.origin_kind AS originKind,c.origin_key AS originKey,c.request_hash AS requestHash";
    String COURSES = " FROM english_course c LEFT JOIN english_course_progress p ON p.course_id=c.id WHERE "
            + "(#{filter}='all' OR (#{filter}='favorite' AND JSON_UNQUOTE(JSON_EXTRACT(p.payload,'$.favorite'))='true') "
            + "OR (#{filter}='review' AND (JSON_LENGTH(JSON_EXTRACT(p.payload,'$.marked'))>0 OR JSON_LENGTH(JSON_EXTRACT(p.payload,'$.wrong'))>0)))";
    String SENTENCES = " FROM english_course c JOIN JSON_TABLE(c.payload,'$.sentences[*]' COLUMNS(ord FOR ORDINALITY, sentence_text VARCHAR(4000) PATH '$.text')) jt "
            + "LEFT JOIN english_course_progress p ON p.course_id=c.id";
    String MARKED = "IFNULL(JSON_CONTAINS(JSON_EXTRACT(p.payload,'$.marked'),CAST(jt.ord-1 AS CHAR)),0)";
    @Select("SELECT " + FIELDS + COURSES + " ORDER BY c.created_at DESC,c.sort_order,c.id LIMIT 10 OFFSET #{offset}")
    List<CourseEntity> list(int offset, String filter);
    @Select("SELECT COUNT(*)" + COURSES)
    long total(String filter);
    @Select("SELECT c.id AS courseId,c.title,jt.ord-1 AS sentenceIndex,jt.sentence_text AS text," + MARKED + " AS marked" + SENTENCES
            + " WHERE (#{markedOnly}=FALSE OR " + MARKED + ") ORDER BY c.sort_order,c.id,jt.ord LIMIT 10 OFFSET #{offset}")
    List<CourseSentenceEntity> sentences(int offset, boolean markedOnly);
    @Select("SELECT COUNT(*)" + SENTENCES + " WHERE (#{markedOnly}=FALSE OR " + MARKED + ")")
    long sentenceTotal(boolean markedOnly);
    @Select("SELECT " + FIELDS + " FROM english_course c WHERE c.id=#{id}")
    CourseEntity course(String id);
    @Insert("INSERT IGNORE INTO english_course(id,sort_order,title,focus,source,payload,origin_kind,origin_key,request_hash) "
            + "VALUES(#{id},100,#{title},#{focus},#{source},#{payload},#{originKind},#{originKey},#{requestHash})")
    int insert(CourseEntity course);
    @Select("SELECT revision,payload FROM english_course_progress WHERE course_id=#{id}")
    CourseProgressEntity progress(String id);
    @Insert("INSERT IGNORE INTO english_course_progress(course_id,revision,payload) VALUES(#{id},0,#{payload})")
    void initialize(String id, String payload);
    @Select("SELECT revision,payload FROM english_course_progress WHERE course_id=#{id} FOR UPDATE")
    CourseProgressEntity lock(String id);
    @Update("UPDATE english_course_progress SET revision=revision+1,payload=#{payload},updated_at=CURRENT_TIMESTAMP(6) WHERE course_id=#{id}")
    void save(String id, String payload);
    @Select("SELECT request_hash AS requestHash,result FROM english_course_operation WHERE course_id=#{id} AND operation=#{operation} FOR UPDATE")
    CourseOperationEntity operation(String id, String operation);
    @Insert("INSERT INTO english_course_operation(course_id,operation,request_hash,result) VALUES(#{id},#{operation},#{hash},#{result})")
    void receipt(String id, String operation, String hash, String result);
}
