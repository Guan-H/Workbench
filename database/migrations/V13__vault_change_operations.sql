ALTER TABLE vault_snapshot_history
    ADD COLUMN operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ADD COLUMN base_version BIGINT NULL,
    ADD UNIQUE KEY vault_history_operation (operation_id);
