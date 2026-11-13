-- Single-user calendar records are ordinary account data, separate from vault ciphertext.
CREATE TABLE calendar_record_lock (id INT PRIMARY KEY) ENGINE=InnoDB;
INSERT INTO calendar_record_lock(id) VALUES(1);
CREATE TABLE calendar_record (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    kind VARCHAR(16) NOT NULL,
    event_date DATE NOT NULL,
    title VARCHAR(200) NOT NULL,
    notes TEXT NOT NULL,
    task_time VARCHAR(5) NULL,
    completed BOOLEAN NOT NULL,
    started_at DATETIME NULL,
    ended_at DATETIME NULL,
    break_minutes INT NOT NULL,
    overtime_minutes INT NOT NULL,
    version BIGINT NOT NULL,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY calendar_record_month(deleted,event_date,id)
) ENGINE=InnoDB;
CREATE TABLE calendar_record_operation (
    operation CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    result TEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;
