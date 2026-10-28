CREATE TABLE account (
    id TINYINT PRIMARY KEY,
    username VARCHAR(80) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    CONSTRAINT single_account CHECK (id = 1)
) ENGINE=InnoDB;

CREATE TABLE web_session (
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    expires_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6))
) ENGINE=InnoDB;

CREATE TABLE login_attempt (
    client_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    failures INT NOT NULL,
    blocked_until DATETIME(6) NULL
) ENGINE=InnoDB;

CREATE TABLE notebook_lock (id TINYINT PRIMARY KEY) ENGINE=InnoDB;
INSERT INTO notebook_lock VALUES (1);

CREATE TABLE file_object (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    size BIGINT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6))
) ENGINE=InnoDB;

CREATE TABLE note_file (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    path VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NOT NULL UNIQUE,
    type VARCHAR(16) NOT NULL,
    version BIGINT NOT NULL,
    object_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    content LONGTEXT NULL,
    size BIGINT NOT NULL DEFAULT 0,
    sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    favorite BOOLEAN NOT NULL DEFAULT FALSE,
    last_opened_at DATETIME(6) NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    FOREIGN KEY (object_id) REFERENCES file_object(id)
) ENGINE=InnoDB;

CREATE TABLE note_revision (
    file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    version BIGINT NOT NULL,
    object_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    path VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NOT NULL,
    deleted BOOLEAN NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    PRIMARY KEY (file_id, version),
    FOREIGN KEY (file_id) REFERENCES note_file(id),
    FOREIGN KEY (object_id) REFERENCES file_object(id)
) ENGINE=InnoDB;

CREATE TABLE note_change (
    sequence_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    version BIGINT NOT NULL,
    deleted BOOLEAN NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6))
) ENGINE=InnoDB;

CREATE TABLE note_operation (
    operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    scope VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    response_json MEDIUMTEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    PRIMARY KEY (operation_id, scope)
) ENGINE=InnoDB;
