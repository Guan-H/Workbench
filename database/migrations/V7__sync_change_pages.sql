ALTER TABLE note_change
    ADD COLUMN metadata_json JSON NULL,
    ADD COLUMN before_path VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NULL,
    ADD COLUMN references_changed BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN purged BOOLEAN NOT NULL DEFAULT FALSE,
    ADD INDEX ix_note_change_file_version (file_id, version),
    ADD INDEX ix_note_change_created (created_at, sequence_id);

-- Old events have no immutable metadata. A new snapshot establishes a safe starting cursor.
CREATE TABLE sync_log_state (
    id TINYINT PRIMARY KEY,
    floor_cursor BIGINT NOT NULL
) ENGINE=InnoDB;
INSERT INTO sync_log_state SELECT 1, COALESCE(MAX(sequence_id), 0) FROM note_change;

ALTER TABLE sync_device
    ADD COLUMN attachment_paths_json JSON NULL,
    ADD COLUMN snapshot_scope_version BIGINT NULL;
