-- Learning progress is separate from immutable received batches and encrypted vault data.
CREATE TABLE english_study_state (
    id INT PRIMARY KEY, catalog_cursor BIGINT NOT NULL DEFAULT 0,
    revision BIGINT NOT NULL DEFAULT 0, new_limit INT NOT NULL DEFAULT 10,
    review_limit INT NOT NULL DEFAULT 20, sentence_limit INT NOT NULL DEFAULT 3
) ENGINE=InnoDB;
INSERT INTO english_study_state(id) VALUES(1);
CREATE TABLE english_study_item (
    id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    kind VARCHAR(16) NOT NULL, name VARCHAR(4000) NOT NULL, meaning VARCHAR(4000) NOT NULL,
    payload TEXT NOT NULL, KEY study_item_kind(kind)
) ENGINE=InnoDB;
CREATE TABLE english_study_source (
    item_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    batch_id BIGINT NOT NULL, article_index INT NOT NULL DEFAULT -1,
    PRIMARY KEY(item_id,batch_id,article_index), KEY study_source_batch(batch_id)
) ENGINE=InnoDB;
CREATE TABLE english_study_progress (
    item_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    mode VARCHAR(16) NOT NULL, stage INT NOT NULL DEFAULT 0,
    mistakes INT NOT NULL DEFAULT 0, last_date DATE NULL, wrong_date DATE NULL, next_date DATE NULL,
    PRIMARY KEY(item_id,mode), KEY study_progress_due(mode,next_date)
) ENGINE=InnoDB;
CREATE TABLE english_study_plan (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, learning_date DATE NOT NULL UNIQUE,
    operation CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    new_limit INT NOT NULL, review_limit INT NOT NULL, sentence_limit INT NOT NULL,
    anchor_batch_id BIGINT NULL
) ENGINE=InnoDB;
CREATE TABLE english_study_task (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    plan_id BIGINT NOT NULL, item_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    mode VARCHAR(16) NOT NULL, kind VARCHAR(16) NOT NULL, completed BOOLEAN NOT NULL DEFAULT FALSE,
    revision BIGINT NOT NULL DEFAULT 0, answer TEXT NOT NULL, submitted BOOLEAN NOT NULL DEFAULT FALSE,
    rating VARCHAR(16) NULL, game_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    UNIQUE KEY study_task_once(plan_id,item_id,mode), KEY study_task_plan(plan_id,mode,completed)
) ENGINE=InnoDB;
CREATE TABLE english_study_game_word (
    game_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, choice_id INT NOT NULL,
    item_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, plan_id BIGINT NOT NULL,
    PRIMARY KEY(game_id,choice_id)
) ENGINE=InnoDB;
CREATE TABLE english_study_operation (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, response_json MEDIUMTEXT NOT NULL
) ENGINE=InnoDB;
