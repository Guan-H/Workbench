ALTER TABLE ai_chat_turn ADD COLUMN selected_answer_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;

CREATE TABLE ai_chat_answer (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    turn_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    version INT NOT NULL,
    reply MEDIUMTEXT NOT NULL,
    provider VARCHAR(80) NOT NULL,
    model_id VARCHAR(160) NOT NULL,
    actual_model VARCHAR(255) NULL,
    status VARCHAR(16) NOT NULL,
    error_message VARCHAR(255) NULL,
    finish_reason VARCHAR(32) NULL,
    elapsed_ms BIGINT NULL,
    total_tokens BIGINT NULL,
    UNIQUE KEY ai_chat_answer_version (turn_id, version),
    INDEX ai_chat_answer_status (status),
    CONSTRAINT ai_chat_answer_turn FOREIGN KEY (turn_id) REFERENCES ai_chat_turn(id) ON DELETE CASCADE
);

INSERT INTO ai_chat_answer (id, turn_id, version, reply, provider, model_id, actual_model,
    status, error_message, finish_reason, elapsed_ms, total_tokens)
SELECT id, id, 1, reply, provider, model_id, actual_model, status, error_message,
    finish_reason, elapsed_ms, total_tokens FROM ai_chat_turn;

UPDATE ai_chat_turn SET selected_answer_id = id;
ALTER TABLE ai_chat_turn MODIFY selected_answer_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
