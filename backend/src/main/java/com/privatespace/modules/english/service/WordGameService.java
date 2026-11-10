package com.privatespace.modules.english.service;

import com.privatespace.modules.english.dto.WordGameDtos.*;

/** Creates six-pair rounds from persisted batches and grades revision-checked, idempotent attempts. */
public interface WordGameService {
    Snapshot create(Create request, String operation);
    Snapshot read(String id);
    Snapshot answer(String id, Answer request, String operation);
}
