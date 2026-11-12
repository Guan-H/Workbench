-- Independent plaintext diagrams; they never share vault or note objects.
CREATE TABLE mind_map_lock (id INT PRIMARY KEY) ENGINE=InnoDB;
INSERT INTO mind_map_lock(id) VALUES(1);
CREATE TABLE mind_map (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    title VARCHAR(120) NOT NULL,
    version BIGINT NOT NULL,
    document MEDIUMTEXT NOT NULL,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY mind_map_list(deleted,updated_at,id)
) ENGINE=InnoDB;
CREATE TABLE mind_map_operation (
    operation CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    result TEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;
