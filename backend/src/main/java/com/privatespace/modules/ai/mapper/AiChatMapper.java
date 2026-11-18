package com.privatespace.modules.ai.mapper;

import com.privatespace.modules.ai.dto.AiChat.Conversation;
import com.privatespace.modules.ai.dto.AiChat.Turn;
import com.privatespace.modules.ai.dto.AiChat.Version;
import com.privatespace.modules.ai.dto.AiRequests.Result;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

@Mapper
public interface AiChatMapper {
    String CHAT = "id, title, model_id AS modelId, revision, updated_at AS updatedAt, pinned, provider_id AS providerId";
    String TURN = """
            t.id, t.conversation_id AS conversationId, t.position, t.prompt, a.reply, a.provider, a.model_id AS modelId,
            a.actual_model AS actualModel, a.status, a.error_message AS errorMessage, a.finish_reason AS finishReason,
            a.elapsed_ms AS elapsedMs, a.total_tokens AS totalTokens, a.id AS answerId, a.version, c.revision, a.provider_id AS providerId
            """;
    String ANSWERS = " FROM ai_chat_turn t JOIN ai_conversation c ON c.id=t.conversation_id"
            + " JOIN ai_chat_answer a ON a.turn_id=t.id WHERE t.conversation_id=#{conversationId}";

    @Insert("INSERT INTO ai_conversation (id,title,model_id,updated_at) VALUES (#{id},'新会话','',UTC_TIMESTAMP(6))")
    void create(String id);

    @Select("<script>SELECT " + CHAT + " " + """
            FROM ai_conversation
            <if test="query != ''"> WHERE LOCATE(#{query}, title) &gt; 0 </if>
            ORDER BY pinned DESC, updated_at DESC, id DESC LIMIT 30 OFFSET #{offset}
            </script>
            """)
    List<Conversation> list(String query, int offset);

    @Select("SELECT " + CHAT + " FROM ai_conversation WHERE id=#{id}")
    Conversation find(String id);

    @Select("SELECT " + CHAT + " FROM ai_conversation WHERE id=#{id} FOR UPDATE")
    Conversation lock(String id);

    @Select("SELECT " + TURN + ANSWERS + " AND a.id=t.selected_answer_id ORDER BY t.position")
    List<Turn> turns(String conversationId);

    @Select("SELECT " + TURN + ANSWERS + " AND a.id=#{answerId}")
    Turn answer(String conversationId, String answerId);

    @Select("SELECT " + TURN + ANSWERS + " AND a.status='generating' LIMIT 1")
    Turn activeAnswer(String conversationId);

    @Select("""
            SELECT t.id AS turnId, a.id AS answerId, a.version
            FROM ai_chat_turn t JOIN ai_chat_answer a ON a.turn_id=t.id
            WHERE t.conversation_id=#{conversationId} ORDER BY t.position, a.version
            """)
    List<Version> versions(String conversationId);

    @Select("SELECT MAX(version) FROM ai_chat_answer WHERE turn_id=#{turnId}")
    int lastVersion(String turnId);

    @Insert("""
            INSERT INTO ai_chat_turn (id,conversation_id,position,prompt,reply,provider,model_id,status,selected_answer_id)
            VALUES (#{id},#{conversationId},#{position},#{prompt},'','','','migrated',#{answerId})
            """)
    void insertTurn(Turn turn);

    @Insert("""
            INSERT INTO ai_chat_answer (id,turn_id,version,reply,provider,model_id,status,provider_id)
            VALUES (#{answerId},#{id},#{version},'',#{provider},#{modelId},'generating',#{providerId})
            """)
    void insertAnswer(Turn turn);

    @Update("""
            UPDATE ai_conversation SET model_id=#{modelId}, provider_id=#{providerId},
            title=CASE WHEN NOT title_custom AND #{title,jdbcType=VARCHAR} IS NOT NULL THEN #{title,jdbcType=VARCHAR} ELSE title END,
            revision=revision+1, updated_at=UTC_TIMESTAMP(6) WHERE id=#{id}
            """)
    void advance(String id, String modelId, String providerId, String title);

    @Update("UPDATE ai_conversation SET title=#{title}, title_custom=TRUE, revision=revision+1 WHERE id=#{id}")
    void rename(String id, String title);

    @Update("UPDATE ai_conversation SET pinned=#{pinned}, revision=revision+1 WHERE id=#{id}")
    void pin(String id, boolean pinned);

    @Delete("DELETE FROM ai_conversation WHERE id=#{id}")
    void delete(String id);

    @Update("UPDATE ai_chat_turn SET selected_answer_id=#{answerId} WHERE id=#{turnId}")
    void selectAnswer(String turnId, String answerId);

    @Update("UPDATE ai_chat_answer SET reply=CONCAT(reply,#{text}) WHERE id=#{id} AND status='generating'")
    int append(String id, String text);

    @Update("""
            UPDATE ai_chat_answer SET status=CASE WHEN #{result.finishReason}='length' THEN 'truncated' ELSE 'complete' END,
            reply=#{result.text}, actual_model=#{result.model},
            finish_reason=#{result.finishReason}, elapsed_ms=#{result.elapsedMs}, total_tokens=#{totalTokens,jdbcType=BIGINT}
            WHERE id=#{id} AND status='generating'
            """)
    void complete(String id, Result result, Long totalTokens);

    @Update("""
            UPDATE ai_chat_answer SET status=#{status}, error_message=#{message,jdbcType=VARCHAR},
            elapsed_ms=#{elapsedMs,jdbcType=BIGINT} WHERE id=#{id} AND status='generating'
            """)
    int end(String id, String status, String message, Long elapsedMs);

    @Update("UPDATE ai_chat_answer SET status='interrupted' WHERE status='generating'")
    void interruptPreviousRun();
}
