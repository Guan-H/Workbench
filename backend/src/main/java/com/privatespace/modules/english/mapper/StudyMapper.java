package com.privatespace.modules.english.mapper;

import java.time.LocalDate;
import java.util.List;
import org.apache.ibatis.annotations.*;
import com.privatespace.modules.english.entity.StudyEntities.*;

@Mapper
public interface StudyMapper {
    String STATE = "SELECT catalog_cursor AS catalogCursor,revision,new_limit AS newLimit,review_limit AS reviewLimit,sentence_limit AS sentenceLimit FROM english_study_state WHERE id=1";
    String ITEM = "SELECT id,kind,name,meaning,payload FROM english_study_item";
    String PROGRESS = "SELECT item_id AS itemId,mode,stage,mistakes,last_date AS lastDate,wrong_date AS wrongDate,next_date AS nextDate FROM english_study_progress";
    String PLAN = "SELECT id,learning_date AS learningDate,operation,new_limit AS newLimit,review_limit AS reviewLimit,sentence_limit AS sentenceLimit,anchor_batch_id AS anchorBatchId FROM english_study_plan";
    String TASK = "SELECT id,plan_id AS planId,item_id AS itemId,mode,kind,completed,revision,answer,submitted,rating,game_id AS gameId FROM english_study_task";
    String FILTER = " FROM english_study_item i WHERE i.kind=#{kind} AND (#{query}='' OR i.name LIKE CONCAT('%',#{query},'%') OR i.meaning LIKE CONCAT('%',#{query},'%')) AND (#{wrong}=FALSE OR EXISTS(SELECT 1 FROM english_study_progress p WHERE p.item_id=i.id AND p.mistakes>0))";

    @Select(STATE) State state();
    @Select(STATE + " FOR UPDATE") State lockState();
    @Update("UPDATE english_study_state SET catalog_cursor=#{cursor} WHERE id=1") void cursor(long cursor);
    @Update("UPDATE english_study_state SET revision=revision+1,new_limit=#{newLimit},review_limit=#{reviewLimit},sentence_limit=#{sentenceLimit} WHERE id=1")
    void settings(int newLimit, int reviewLimit, int sentenceLimit);
    @Insert("INSERT IGNORE INTO english_study_item(id,kind,name,meaning,payload) VALUES(#{id},#{kind},#{name},#{meaning},#{payload})") void insertItem(Item item);
    @Insert("INSERT IGNORE INTO english_study_source(item_id,batch_id,article_index) VALUES(#{id},#{batchId},#{articleIndex})") void source(String id,long batchId,int articleIndex);
    @Select(ITEM + " WHERE id=#{id}") Item item(String id);
    @Select("SELECT i.id,i.kind,i.name,i.meaning,i.payload" + FILTER + " ORDER BY i.name,i.id LIMIT 10 OFFSET #{offset}")
    List<Item> items(String kind,String query,boolean wrong,int offset);
    @Select("SELECT COUNT(*)" + FILTER) long total(String kind,String query,boolean wrong);
    @Select("SELECT s.batch_id AS batchId,CAST(b.learning_date AS CHAR) AS date,s.article_index AS articleIndex FROM english_study_source s JOIN english_batch b ON b.id=s.batch_id WHERE s.item_id=#{id} ORDER BY s.batch_id DESC,s.article_index LIMIT 100")
    List<Source> sources(String id);
    @Select(PROGRESS + " WHERE item_id=#{id} ORDER BY mode") List<Progress> progress(String id);
    @Insert("INSERT IGNORE INTO english_study_progress(item_id,mode) VALUES(#{id},#{mode})") void ensureProgress(String id,String mode);
    @Select(PROGRESS + " WHERE item_id=#{id} AND mode=#{mode} FOR UPDATE") Progress lockProgress(String id,String mode);
    @Update("UPDATE english_study_progress SET stage=#{stage},mistakes=#{mistakes},last_date=#{lastDate},wrong_date=#{wrongDate},next_date=#{nextDate} WHERE item_id=#{itemId} AND mode=#{mode}") void saveProgress(Progress progress);
    @Select(PROGRESS + " WHERE mode IN ('matching','spelling') AND next_date<=#{date} ORDER BY next_date,item_id,mode LIMIT #{limit}")
    List<Progress> dueWords(LocalDate date,int limit);
    @Select("SELECT id,kind,name,meaning,payload FROM (SELECT i.*,ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(name)) ORDER BY id) AS sense_order FROM english_study_item i WHERE kind='word' AND (SELECT COUNT(*) FROM english_study_progress p WHERE p.item_id=i.id AND p.mode IN ('matching','spelling'))<2) candidates WHERE sense_order=1 ORDER BY name,id LIMIT #{limit}")
    List<Item> newWords(int limit);
    @Select("SELECT i.id,i.kind,i.name,i.meaning,i.payload FROM english_study_item i LEFT JOIN english_study_progress p ON p.item_id=i.id AND p.mode=#{mode} WHERE i.kind='sentence' AND (p.item_id IS NULL OR p.next_date<=#{date}) ORDER BY CASE WHEN p.item_id IS NULL THEN 1 ELSE 0 END,p.next_date,i.id LIMIT #{limit}")
    List<Item> sentences(LocalDate date,String mode,int limit);
    @Select("SELECT COUNT(*) FROM english_study_progress WHERE next_date<=#{date}") long due(LocalDate date);
    @Select(PLAN + " WHERE learning_date=#{date}") Plan plan(LocalDate date);
    @Select(PLAN + " WHERE operation=#{operation}") Plan planOperation(String operation);
    @Select(PLAN + " WHERE id=#{id} FOR UPDATE") Plan lockPlan(long id);
    @Insert("INSERT INTO english_study_plan(learning_date,operation,new_limit,review_limit,sentence_limit) VALUES(#{date},#{operation},#{newLimit},#{reviewLimit},#{sentenceLimit})")
    void insertPlan(LocalDate date,String operation,int newLimit,int reviewLimit,int sentenceLimit);
    @Update("UPDATE english_study_plan SET anchor_batch_id=(SELECT MIN(s.batch_id) FROM english_study_task t JOIN english_study_source s ON s.item_id=t.item_id WHERE t.plan_id=#{id} AND t.mode IN ('matching','spelling')) WHERE id=#{id}") void anchor(long id);
    @Insert("INSERT IGNORE INTO english_study_task(id,plan_id,item_id,mode,kind,answer) VALUES(#{id},#{planId},#{itemId},#{mode},#{kind},'')")
    void task(String id,long planId,String itemId,String mode,String kind);
    @Select(TASK + " WHERE plan_id=#{planId} ORDER BY CASE kind WHEN 'review' THEN 0 ELSE 1 END,id") List<Task> tasks(long planId);
    @Select(TASK + " WHERE id=#{id} FOR UPDATE") Task lockTask(String id);
    @Update("UPDATE english_study_task SET revision=revision+1,answer=#{answer},submitted=#{submitted},rating=#{rating},completed=#{completed} WHERE id=#{id}")
    void translation(String id,String answer,boolean submitted,String rating,boolean completed);
    @Select("SELECT game_id FROM english_study_task WHERE plan_id=#{planId} AND mode=#{mode} AND completed=FALSE AND game_id IS NOT NULL LIMIT 1") String activeGame(long planId,String mode);
    @Update("UPDATE english_study_task SET game_id=#{gameId} WHERE plan_id=#{planId} AND item_id=#{itemId} AND mode=#{mode} AND completed=FALSE")
    void attachGame(long planId,String itemId,String mode,String gameId);
    @Insert("INSERT INTO english_study_game_word(game_id,choice_id,item_id,plan_id) VALUES(#{gameId},#{choiceId},#{itemId},#{planId})")
    void gameWord(String gameId,int choiceId,String itemId,long planId);
    @Select("SELECT item_id FROM english_study_game_word WHERE game_id=#{gameId} AND choice_id=#{choiceId}") String gameItem(String gameId,int choiceId);
    @Select("SELECT DISTINCT plan_id FROM english_study_game_word WHERE game_id=#{gameId}") Long gamePlan(String gameId);
    @Update("UPDATE english_study_task SET completed=TRUE WHERE game_id=#{gameId} AND item_id=#{itemId} AND mode=#{mode}") void completeWord(String gameId,String itemId,String mode);
    @Select("SELECT request_hash AS requestHash,response_json AS responseJson FROM english_study_operation WHERE id=#{id}") Operation operation(String id);
    @Insert("INSERT INTO english_study_operation(id,request_hash,response_json) VALUES(#{id},#{hash},#{response})") void insertOperation(String id,String hash,String response);
}
