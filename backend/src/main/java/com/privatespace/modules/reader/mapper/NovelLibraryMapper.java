package com.privatespace.modules.reader.mapper;
import java.util.List;
import org.apache.ibatis.annotations.*;
import com.privatespace.modules.reader.entity.NovelFolderEntity;
import com.privatespace.modules.reader.entity.NovelBookEntity;
@Mapper
public interface NovelLibraryMapper {
    @Select("SELECT revision FROM novel_library_state WHERE id=1") long revision();
    @Select("SELECT revision FROM novel_library_state WHERE id=1 FOR UPDATE") long lock();
    @Update("UPDATE novel_library_state SET revision=revision+1 WHERE id=1") void advance();
    @Select("SELECT id,parent_id AS parentId,name FROM novel_folder ORDER BY name") List<NovelFolderEntity> folders();
    @Select("SELECT file_id AS fileId,folder_id AS folderId,source_path AS sourcePath FROM novel_book") List<NovelBookEntity> books();
    @Select("SELECT file_id AS fileId,folder_id AS folderId,source_path AS sourcePath FROM novel_book WHERE file_id=#{id}") NovelBookEntity book(String id);
    @Insert("INSERT INTO novel_folder(id,parent_id,name) VALUES(#{id},#{parent},#{name})") void createFolder(String id,String parent,String name);
    @Update("UPDATE novel_folder SET parent_id=#{parent},name=#{name} WHERE id=#{id}") void updateFolder(String id,String parent,String name);
    @Delete("DELETE FROM novel_folder WHERE id=#{id}") void deleteFolder(String id);
    @Insert("INSERT INTO novel_book(file_id,folder_id,source_path) VALUES(#{id},#{parent},#{path})") void add(String id,String parent,String path);
    @Update("UPDATE novel_book SET folder_id=#{parent} WHERE file_id=#{id}") void move(String id,String parent);
    @Delete("DELETE FROM novel_book WHERE file_id=#{id}") void remove(String id);
    @Delete("DELETE FROM novel_book WHERE folder_id=#{id}") void removeFolderBooks(String id);
    @Select("SELECT request_hash FROM novel_library_operation WHERE operation=#{operation}") String operationHash(String operation);
    @Select("SELECT response_json FROM novel_library_operation WHERE operation=#{operation}") String operationResult(String operation);
    @Insert("INSERT INTO novel_library_operation(operation,request_hash,response_json) VALUES(#{operation},#{hash},#{result})") void receipt(String operation,String hash,String result);
}
