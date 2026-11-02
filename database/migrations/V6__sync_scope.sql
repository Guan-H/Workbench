ALTER TABLE sync_pairing ADD COLUMN scope_json TEXT NULL;
ALTER TABLE sync_device ADD COLUMN scope_json TEXT NULL;
ALTER TABLE sync_device ADD COLUMN scope_version BIGINT NOT NULL DEFAULT 1;
