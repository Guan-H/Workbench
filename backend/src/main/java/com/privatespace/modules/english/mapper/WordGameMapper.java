package com.privatespace.modules.english.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import com.privatespace.modules.english.entity.WordGameEntity;

@Mapper
public interface WordGameMapper {
    String COLUMNS = "SELECT id,batch_id AS batchId,review_of AS reviewOf,revision,payload FROM english_word_game";

    @Select(COLUMNS + " WHERE id=#{id}")
    WordGameEntity find(String id);

    @Select(COLUMNS + " WHERE id=#{id} FOR UPDATE")
    WordGameEntity lock(String id);

    @Insert("INSERT IGNORE INTO english_word_game(id,batch_id,review_of,payload) VALUES(#{id},#{batchId},#{reviewOf},#{payload})")
    int create(WordGameEntity game);

    @Update("UPDATE english_word_game SET revision=revision+1,payload=#{payload},updated_at=UTC_TIMESTAMP(6) WHERE id=#{id}")
    void save(String id, String payload);
}
