CREATE TABLE ai_conversation (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    model_id VARCHAR(160) NOT NULL,
    revision INT NOT NULL DEFAULT 0,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    INDEX ai_conversation_recent (updated_at DESC, id DESC)
);

CREATE TABLE ai_chat_turn (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    conversation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    position INT NOT NULL,
    prompt TEXT NOT NULL,
    reply MEDIUMTEXT NOT NULL,
    provider VARCHAR(80) NOT NULL,
    model_id VARCHAR(160) NOT NULL,
    actual_model VARCHAR(255) NULL,
    status VARCHAR(16) NOT NULL,
    error_message VARCHAR(255) NULL,
    finish_reason VARCHAR(32) NULL,
    elapsed_ms BIGINT NULL,
    total_tokens BIGINT NULL,
    UNIQUE KEY ai_chat_turn_order (conversation_id, position),
    INDEX ai_chat_turn_status (status),
    CONSTRAINT ai_chat_turn_conversation FOREIGN KEY (conversation_id) REFERENCES ai_conversation(id) ON DELETE CASCADE
);
