CREATE TABLE office_session (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source_version BIGINT NOT NULL,
    source_object CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    current_version BIGINT NOT NULL,
    source_path VARCHAR(1024) NOT NULL,
    owner_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'OPEN',
    pending_save CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    completed_save CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    last_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    conflict_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    error_code VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
    expires_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    KEY office_file (file_id)
) ENGINE=InnoDB;

CREATE TABLE office_callback_receipt (
    session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (session_id, digest),
    CONSTRAINT callback_office FOREIGN KEY (session_id) REFERENCES office_session(id) ON DELETE CASCADE
) ENGINE=InnoDB;
