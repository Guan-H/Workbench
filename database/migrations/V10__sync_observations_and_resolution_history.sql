-- Only helper observations and completed choices. File contents remain in their existing stores.
ALTER TABLE sync_conflict_feed
    ADD COLUMN client_status_json JSON NULL,
    ADD COLUMN client_status_at DATETIME(6) NULL;

CREATE TABLE sync_conflict_history (
    device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    path VARCHAR(240) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    revision BIGINT NOT NULL,
    metadata_json JSON NOT NULL,
    scope_version BIGINT NOT NULL,
    reported_at DATETIME(6) NOT NULL,
    PRIMARY KEY (device_id, path, revision),
    FOREIGN KEY (device_id) REFERENCES sync_device(id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO sync_conflict_history
    SELECT device_id,path,revision,metadata_json,scope_version,reported_at
    FROM sync_conflict_status WHERE active=FALSE;

CREATE TABLE sync_activity (
    device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision BIGINT NOT NULL,
    status_json JSON NOT NULL,
    scope_version BIGINT NOT NULL,
    reported_at DATETIME(6) NOT NULL,
    PRIMARY KEY (device_id, revision),
    FOREIGN KEY (device_id) REFERENCES sync_device(id) ON DELETE CASCADE
) ENGINE=InnoDB;
