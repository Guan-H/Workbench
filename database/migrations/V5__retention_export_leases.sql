CREATE TABLE file_object_lease (
    lease_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    object_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    PRIMARY KEY (lease_id, object_id),
    INDEX idx_file_object_lease_expires (expires_at),
    FOREIGN KEY (object_id) REFERENCES file_object(id) ON DELETE CASCADE
) ENGINE=InnoDB;
