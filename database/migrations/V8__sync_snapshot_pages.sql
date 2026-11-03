-- A device receives one immutable metadata view across independent HTTP page requests.
CREATE TABLE sync_snapshot (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    scope_version BIGINT NOT NULL,
    metadata_json JSON NOT NULL,
    item_count BIGINT NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    UNIQUE KEY uq_sync_snapshot_device (device_id),
    KEY ix_sync_snapshot_expires (expires_at),
    FOREIGN KEY (device_id) REFERENCES sync_device(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE sync_snapshot_item (
    snapshot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    position BIGINT NOT NULL,
    metadata_json JSON NOT NULL,
    PRIMARY KEY (snapshot_id, position),
    FOREIGN KEY (snapshot_id) REFERENCES sync_snapshot(id) ON DELETE CASCADE
) ENGINE=InnoDB;
