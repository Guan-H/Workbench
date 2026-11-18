ALTER TABLE ai_conversation
    ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN title_custom BOOLEAN NOT NULL DEFAULT FALSE,
    ADD INDEX ai_conversation_pinned_recent (pinned DESC, updated_at DESC, id DESC);
