ALTER TABLE vault_snapshot_history
    ADD COLUMN operation_kind VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL;

UPDATE vault_snapshot_history SET operation_kind = 'master-password' WHERE operation_id IS NOT NULL;
