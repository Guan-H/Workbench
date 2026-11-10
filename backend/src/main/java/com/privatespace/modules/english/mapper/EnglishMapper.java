package com.privatespace.modules.english.mapper;

import java.util.List;
import com.privatespace.modules.english.entity.*;
import org.apache.ibatis.annotations.*;

@Mapper
public interface EnglishMapper {
    String STATE = "SELECT revision,token_hash AS tokenHash,enabled,minute,requests FROM english_webhook_state WHERE id=1";
    String BATCH = "SELECT id,request_id AS requestId,request_hash AS requestHash,CAST(learning_date AS CHAR) AS learningDate,payload,received_at AS receivedAt FROM english_batch";
    @Select(STATE) EnglishState state();
    @Select(STATE + " FOR UPDATE") EnglishState lock();
    @Update("UPDATE english_webhook_state SET token_hash=#{hash},enabled=#{enabled},revision=revision+1 WHERE id=1") void configure(String hash, boolean enabled);
    @Update("UPDATE english_webhook_state SET minute=#{minute},requests=#{count} WHERE id=1") void rate(long minute, int count);
    @Select(BATCH + " WHERE request_id=#{requestId}") EnglishBatch receipt(String requestId);
    @Insert("INSERT INTO english_batch(request_id,request_hash,learning_date,payload) VALUES(#{requestId},#{hash},#{date},#{payload})") void insert(String requestId, String hash, String date, String payload);
    @Select(BATCH + " WHERE learning_date=#{date} ORDER BY id DESC LIMIT 1") EnglishBatch latest(String date);
    @Select(BATCH + " WHERE learning_date=#{date} ORDER BY id DESC LIMIT 10 OFFSET #{offset}") List<EnglishBatch> history(String date, int offset);
    @Select("SELECT COUNT(*) FROM english_batch WHERE learning_date=#{date}") long total(String date);
    @Select(BATCH + " WHERE id=#{id} AND learning_date=#{date}") EnglishBatch batch(long id, String date);
    @Select(BATCH + " WHERE id=#{id}") EnglishBatch batchById(long id);
    @Insert("INSERT INTO english_webhook_log(request_id,status,code) VALUES(#{requestId},#{status},#{code})") void log(String requestId, String status, String code);
    @Select("SELECT id,request_id AS requestId,status,code,received_at AS receivedAt FROM english_webhook_log ORDER BY id DESC LIMIT 10 OFFSET #{offset}") List<EnglishLog> logs(int offset);
    @Select("SELECT COUNT(*) FROM english_webhook_log") long logTotal();
}
