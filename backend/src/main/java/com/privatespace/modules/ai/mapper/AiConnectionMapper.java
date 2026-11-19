package com.privatespace.modules.ai.mapper;

import com.privatespace.modules.ai.entity.AiConnectionEntity;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

@Mapper
public interface AiConnectionMapper {
    String PROJECTION = """
            id, provider_id AS providerId, revision, credential_revision AS credentialRevision,
            provider_name AS providerName, models, api_key_encrypted AS encryptedKey, base_url AS baseUrl
            """;

    @Select("SELECT " + PROJECTION + " FROM ai_provider_connection WHERE id=#{id}")
    AiConnectionEntity read(String id);

    @Select("SELECT " + PROJECTION + """
             FROM ai_provider_connection WHERE api_key_encrypted IS NOT NULL
             ORDER BY CASE provider_id WHEN 'deepseek' THEN 1 WHEN 'openai' THEN 2 WHEN 'kimi' THEN 3
                 WHEN 'siliconflow' THEN 4 WHEN 'openrouter' THEN 5 ELSE 6 END,
                 (id=provider_id) DESC, created_at, id
            """)
    List<AiConnectionEntity> list();

    @Select("SELECT " + PROJECTION + " FROM ai_provider_connection"
            + " WHERE provider_id=#{providerId} AND provider_name=#{providerName} AND api_key_encrypted IS NULL")
    AiConnectionEntity unconfigured(String providerId, String providerName);

    @Insert("""
            INSERT INTO ai_provider_connection (id, provider_id, provider_name, models, api_key_encrypted, base_url)
            VALUES (#{id}, #{providerId}, #{providerName}, JSON_ARRAY(), #{encryptedKey}, #{baseUrl,jdbcType=VARCHAR})
            """)
    void insert(String id, String providerId, String providerName, byte[] encryptedKey, String baseUrl);

    @Update("""
            UPDATE ai_provider_connection SET provider_name=#{providerName}, api_key_encrypted=#{encryptedKey},
                base_url=COALESCE(#{baseUrl,jdbcType=VARCHAR}, base_url), revision=revision+1
            WHERE id=#{id} AND revision=#{revision} AND api_key_encrypted IS NULL
            """)
    int activate(String id, long revision, String providerName, byte[] encryptedKey, String baseUrl);

    @Delete("DELETE FROM ai_provider_connection WHERE id=#{id} AND revision=#{revision} AND api_key_encrypted IS NOT NULL")
    int delete(String id, long revision);

    @Update("UPDATE ai_deepseek_settings SET api_key_encrypted=NULL WHERE id=1")
    void clearLegacyDeepSeekKey();

    @Update("UPDATE ai_provider_settings SET api_key_encrypted=NULL WHERE provider_id=#{providerId}")
    void clearLegacyPresetKey(String providerId);

    @Update("""
            UPDATE ai_provider_connection
            SET provider_name=#{providerName}, models=#{models},
                api_key_encrypted=COALESCE(#{encryptedKey,jdbcType=VARBINARY}, api_key_encrypted),
                credential_revision=credential_revision+#{credentialChanged}, revision=revision+1
            WHERE id=#{id} AND revision=#{revision}
            """)
    int update(String id, long revision, String providerName, String models, byte[] encryptedKey, int credentialChanged);
}
