CREATE TABLE ai_provider_connection (
    id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    provider_id VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    provider_name VARCHAR(80) NOT NULL,
    revision BIGINT NOT NULL DEFAULT 0,
    credential_revision BIGINT NOT NULL DEFAULT 0,
    models JSON NOT NULL,
    api_key_encrypted VARBINARY(1024) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY ai_provider_connection_name (provider_id, provider_name)
);

INSERT INTO ai_provider_connection (id, provider_id, provider_name, revision, models, api_key_encrypted)
SELECT 'deepseek', 'deepseek', provider_name, revision, models, api_key_encrypted FROM ai_deepseek_settings WHERE id = 1;

INSERT INTO ai_provider_connection (id, provider_id, provider_name, revision, models, api_key_encrypted)
SELECT provider_id, provider_id, provider_name, revision, models, api_key_encrypted FROM ai_provider_settings;

ALTER TABLE ai_conversation
    ADD COLUMN connection_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN credential_revision BIGINT NOT NULL DEFAULT 0;
UPDATE ai_conversation SET connection_id = provider_id;
ALTER TABLE ai_conversation MODIFY connection_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

ALTER TABLE ai_chat_answer
    ADD COLUMN connection_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN credential_revision BIGINT NOT NULL DEFAULT 0;
UPDATE ai_chat_answer SET connection_id = provider_id;
ALTER TABLE ai_chat_answer MODIFY connection_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

ALTER TABLE ai_chat_preference ADD COLUMN connection_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;
UPDATE ai_chat_preference SET connection_id = provider_id;
ALTER TABLE ai_chat_preference ADD CONSTRAINT ai_chat_preference_connection_pair CHECK ((provider_id IS NULL) = (connection_id IS NULL));
