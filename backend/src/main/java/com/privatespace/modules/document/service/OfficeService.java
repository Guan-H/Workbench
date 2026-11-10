package com.privatespace.modules.document.service;

import java.util.Map;
import tools.jackson.databind.JsonNode;
import com.privatespace.modules.note.dto.NoteResponse;

public interface OfficeService {
    Map<String,Object> open(String fileId, String baseVersion, String sessionToken);
    Map<String,Object> status(String id, String sessionToken);
    Map<String,Object> save(String id, String sessionToken);
    byte[] source(String id, String token);
    Map<String,Integer> callback(String id, JsonNode body, String authorization);
    NoteResponse convert(String fileId, String baseVersion, String target, String operation, String sessionToken);
}
