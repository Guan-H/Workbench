ALTER TABLE english_course
    ADD COLUMN origin_kind VARCHAR(16) NOT NULL DEFAULT 'original',
    ADD COLUMN origin_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    ADD UNIQUE KEY reading_origin(origin_kind,origin_key);

CREATE TABLE english_reading_source (
    id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    revision BIGINT NOT NULL DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    running_since DATETIME(6) NULL,
    last_attempt_at DATETIME(6) NULL,
    last_success_at DATETIME(6) NULL,
    retry_after_at DATETIME(6) NULL,
    last_added INT NOT NULL DEFAULT 0,
    last_skipped INT NOT NULL DEFAULT 0,
    last_error VARCHAR(300) NULL
) ENGINE=InnoDB;
INSERT INTO english_reading_source(id) VALUES('nasa');
