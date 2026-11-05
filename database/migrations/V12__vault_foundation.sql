CREATE TABLE vault_snapshot (
    account_id TINYINT PRIMARY KEY,
    vault_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    version BIGINT NOT NULL,
    envelope MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    creation_operation CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CONSTRAINT vault_account FOREIGN KEY (account_id) REFERENCES account(id),
    CONSTRAINT positive_vault_version CHECK (version > 0)
) ENGINE=InnoDB;

CREATE TABLE vault_snapshot_history (
    vault_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    version BIGINT NOT NULL,
    envelope MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    PRIMARY KEY (vault_id, version),
    CONSTRAINT history_vault FOREIGN KEY (vault_id) REFERENCES vault_snapshot(vault_id)
) ENGINE=InnoDB;
