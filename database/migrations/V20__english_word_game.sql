CREATE TABLE english_word_game (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    batch_id BIGINT NOT NULL,
    review_of CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    revision BIGINT NOT NULL DEFAULT 0,
    payload MEDIUMTEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    updated_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    KEY english_word_game_batch (batch_id)
) ENGINE=InnoDB;
