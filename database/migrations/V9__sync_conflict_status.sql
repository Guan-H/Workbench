-- Device observations only: never store local file bodies or imply live connectivity.
CREATE TABLE sync_conflict_feed (
    device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    revision BIGINT NOT NULL,
    reported_at DATETIME(6) NOT NULL,
    scope_version BIGINT NOT NULL,
    FOREIGN KEY (device_id) REFERENCES sync_device(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE sync_conflict_status (
    device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    path VARCHAR(240) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    revision BIGINT NOT NULL,
    active BOOLEAN NOT NULL,
    metadata_json JSON NOT NULL,
    scope_version BIGINT NOT NULL,
    reported_at DATETIME(6) NOT NULL,
    PRIMARY KEY (device_id, path),
    FOREIGN KEY (device_id) REFERENCES sync_device(id) ON DELETE CASCADE
) ENGINE=InnoDB;
