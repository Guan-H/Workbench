-- Recovery wraps the same data key; plaintext recovery secrets never enter this table.
CREATE TABLE vault_recovery_key (
    vault_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    recovery_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    envelope TEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CONSTRAINT recovery_vault FOREIGN KEY (vault_id) REFERENCES vault_snapshot(vault_id)
) ENGINE=InnoDB;
