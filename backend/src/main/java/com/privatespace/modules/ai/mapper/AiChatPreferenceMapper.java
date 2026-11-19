package com.privatespace.modules.ai.mapper;

import com.privatespace.modules.ai.dto.AiRequests.DefaultModel;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface AiChatPreferenceMapper {
    @Select("SELECT revision, provider_id AS providerId, model_id AS modelId, connection_id AS connectionId FROM ai_chat_preference WHERE id=1")
    DefaultModel read();

    @Update("""
            UPDATE ai_chat_preference
            SET provider_id=#{providerId,jdbcType=VARCHAR}, model_id=#{modelId,jdbcType=VARCHAR},
                connection_id=#{connectionId,jdbcType=VARCHAR}, revision=revision+1
            WHERE id=1 AND revision=#{revision}
            """)
    int update(DefaultModel model);
}
