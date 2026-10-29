CREATE TABLE note_delete_member (
    root_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    root_deleted_version BIGINT NOT NULL,
    file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    before_version BIGINT NOT NULL,
    deleted_version BIGINT NOT NULL,
    path VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci NOT NULL,
    PRIMARY KEY (root_id, root_deleted_version, file_id),
    FOREIGN KEY (root_id) REFERENCES note_file(id),
    FOREIGN KEY (file_id, before_version) REFERENCES note_revision(file_id, version)
) ENGINE=InnoDB;
