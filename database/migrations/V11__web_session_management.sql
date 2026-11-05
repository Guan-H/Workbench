ALTER TABLE web_session
    ADD COLUMN id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;

-- Existing cookies keep their original hash and expiry during the upgrade.
UPDATE web_session SET id = UUID() WHERE id IS NULL;

ALTER TABLE web_session
    MODIFY COLUMN id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()),
    ADD UNIQUE KEY uk_web_session_id (id),
    ADD KEY idx_web_session_expiry (expires_at);
