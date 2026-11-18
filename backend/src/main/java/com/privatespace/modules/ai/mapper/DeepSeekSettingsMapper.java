package com.privatespace.modules.ai.mapper;

import com.privatespace.modules.ai.entity.DeepSeekSettingsEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface DeepSeekSettingsMapper {
    @Select("SELECT revision, provider_name AS providerName, models, api_key_encrypted AS encryptedKey FROM ai_deepseek_settings WHERE id=1")
    DeepSeekSettingsEntity read();

    @Update("""
            UPDATE ai_deepseek_settings
            SET provider_name=#{providerName}, models=#{models},
                api_key_encrypted=COALESCE(#{encryptedKey,jdbcType=VARBINARY}, api_key_encrypted), revision=revision+1
            WHERE id=1 AND revision=#{revision}
            """)
    int update(long revision, String providerName, String models, byte[] encryptedKey);

    @Select("SELECT revision, provider_name AS providerName, models, api_key_encrypted AS encryptedKey FROM ai_provider_settings WHERE provider_id=#{providerId}")
    DeepSeekSettingsEntity readPreset(String providerId);

    @Update("""
            UPDATE ai_provider_settings
            SET provider_name=#{providerName}, models=#{models},
                api_key_encrypted=COALESCE(#{encryptedKey,jdbcType=VARBINARY}, api_key_encrypted), revision=revision+1
            WHERE provider_id=#{providerId} AND revision=#{revision}
            """)
    int updatePreset(String providerId, long revision, String providerName, String models, byte[] encryptedKey);
}
