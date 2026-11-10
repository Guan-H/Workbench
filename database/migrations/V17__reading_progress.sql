CREATE TABLE reading_progress (
    file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    revision BIGINT NOT NULL DEFAULT 0,
    source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    format VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
    locator VARCHAR(2048) NULL,
    operation CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6))
) ENGINE=InnoDB;
