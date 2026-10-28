-- M0-only tables in private_space_it. Never packaged as product migrations.
CREATE TABLE IF NOT EXISTS verification_vault (
    vault_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    version BIGINT NOT NULL,
    envelope MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS verification_vault_history (
    vault_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    version BIGINT NOT NULL,
    envelope MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (vault_id, version)
) ENGINE=InnoDB;
