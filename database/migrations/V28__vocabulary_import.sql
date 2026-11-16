-- Imported words share existing identities/progress without creating received batches.
ALTER TABLE english_study_item ADD COLUMN manually_imported BOOLEAN NOT NULL DEFAULT FALSE;
-- A vocabulary round, or an import-only plan, has no received batch.
ALTER TABLE english_word_game MODIFY COLUMN batch_id BIGINT NULL;
