package com.privatespace.modules.note.service;

public interface RetentionService {
    CleanupResult cleanup();

    record CleanupResult(int trashFiles, int revisions, int databaseObjects, int physicalOrphans) {
    }
}
