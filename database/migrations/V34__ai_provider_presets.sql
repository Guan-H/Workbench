CREATE TABLE ai_provider_settings (
    provider_id VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    revision BIGINT NOT NULL DEFAULT 0,
    provider_name VARCHAR(80) NOT NULL,
    models JSON NOT NULL,
    api_key_encrypted VARBINARY(1024) NULL
);

INSERT INTO ai_provider_settings (provider_id, provider_name, models) VALUES
    ('openai', 'OpenAI', JSON_ARRAY()),
    ('kimi', 'Kimi', JSON_ARRAY()),
    ('siliconflow', '硅基流动', JSON_ARRAY()),
    ('openrouter', 'OpenRouter', JSON_ARRAY());

ALTER TABLE ai_conversation ADD COLUMN provider_id VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'deepseek';
ALTER TABLE ai_chat_answer ADD COLUMN provider_id VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'deepseek';
