CREATE TABLE workspace_background (
    id CHAR(36) PRIMARY KEY,
    image MEDIUMBLOB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE workspace_appearance (
    id INT PRIMARY KEY,
    version BIGINT NOT NULL DEFAULT 0,
    settings TEXT NOT NULL
) ENGINE=InnoDB;
INSERT INTO workspace_appearance VALUES(1,0,'{}');
