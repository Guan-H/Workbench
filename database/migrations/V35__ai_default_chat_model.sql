CREATE TABLE ai_chat_preference (
    id TINYINT NOT NULL PRIMARY KEY,
    revision BIGINT NOT NULL DEFAULT 0,
    provider_id VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,
    model_id VARCHAR(160) NULL,
    CONSTRAINT ai_chat_preference_model_pair CHECK ((provider_id IS NULL) = (model_id IS NULL))
);

INSERT INTO ai_chat_preference (id) VALUES (1);
