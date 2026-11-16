ALTER TABLE calendar_record ADD COLUMN time_off_minutes INT NOT NULL DEFAULT 0;
ALTER TABLE calendar_record_lock ADD COLUMN revision BIGINT NOT NULL DEFAULT 0;
CREATE TABLE calendar_opening_balance (
    id INT PRIMARY KEY,
    version BIGINT NOT NULL DEFAULT 0,
    start_date DATE NULL,
    opening_minutes BIGINT NULL
) ENGINE=InnoDB;
INSERT INTO calendar_opening_balance(id) VALUES(1);
