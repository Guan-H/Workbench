CREATE TABLE novel_library_state (id INT PRIMARY KEY, revision BIGINT NOT NULL DEFAULT 0) ENGINE=InnoDB;
INSERT INTO novel_library_state(id) VALUES(1);
CREATE TABLE novel_folder (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    parent_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
    name VARCHAR(120) NOT NULL,
    UNIQUE KEY novel_folder_name(parent_id,name)
) ENGINE=InnoDB;
CREATE TABLE novel_book (
    file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    folder_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
    source_path VARCHAR(1024) NOT NULL,
    KEY novel_book_folder(folder_id)
) ENGINE=InnoDB;
-- Preserve books actually read before the independent catalogue existed, not every note/attachment.
INSERT INTO novel_book(file_id,source_path)
SELECT p.file_id,n.path FROM reading_progress p JOIN note_file n ON n.id=p.file_id
WHERE p.revision>0 AND n.deleted=FALSE AND LOWER(n.path) REGEXP '\\.(txt|epub)$';
CREATE TABLE novel_library_operation (
    operation CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    response_json TEXT NOT NULL
) ENGINE=InnoDB;
