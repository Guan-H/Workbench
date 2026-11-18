CREATE TABLE ai_deepseek_settings (
    id TINYINT NOT NULL PRIMARY KEY,
    revision BIGINT NOT NULL DEFAULT 0,
    provider_name VARCHAR(80) NOT NULL,
    models JSON NOT NULL,
    api_key_encrypted VARBINARY(1024) NULL
);

INSERT INTO ai_deepseek_settings (id, provider_name, models)
VALUES (1, 'DeepSeek', JSON_ARRAY());
