package com.privatespace.modules.file.service;

import java.util.Map;
import com.privatespace.modules.file.dto.TextFileRequest;
import com.privatespace.modules.note.dto.NoteResponse;

public interface TextFileService {
    Map<String, Object> read(String id, String encoding);
    NoteResponse save(String id, TextFileRequest request, String operation);
}
