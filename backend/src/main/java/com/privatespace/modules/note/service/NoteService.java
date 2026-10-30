package com.privatespace.modules.note.service;

import java.util.Map;

import com.privatespace.modules.note.dto.NoteResponse;
import com.privatespace.modules.note.dto.WriteNoteRequest;
import com.privatespace.modules.note.dto.SyncWriteRequest;

public interface NoteService {
    Map<String, Object> list(boolean deleted, String cursor, String query);
    Map<String, Object> list(boolean deleted, String cursor, String query, boolean includeGroups);
    NoteResponse read(String id, boolean track);
    NoteResponse create(WriteNoteRequest request, String operation);
    NoteResponse save(String id, WriteNoteRequest request, String operation);
    NoteResponse delete(String id, String baseVersion, String operation);
    NoteResponse delete(String id, String baseVersion, String operation, String fingerprint);
    com.privatespace.modules.note.dto.DeletePreviewResponse deletePreview(String id, String baseVersion);
    NoteResponse restore(String id, String version, String baseVersion, String operation);
    Map<String, Object> history(String id, String cursor, int limit);
    NoteResponse revision(String id, String version);
    void favorite(String id, boolean favorite);
    NoteResponse upload(String path, byte[] bytes, String operation);
    byte[] download(String path);
    Map<String, Object> syncSnapshot();
    byte[] syncRead(String id, String version);
    NoteResponse syncWrite(SyncWriteRequest request, String operation, String device);
}
