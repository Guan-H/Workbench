package com.privatespace.modules.note.service;

import java.util.List;

import com.privatespace.modules.note.dto.ImportPreviewResponse;
import com.privatespace.modules.note.dto.ImportResultResponse;
import org.springframework.web.multipart.MultipartFile;

/** Previews and atomically publishes ordinary Markdown directory imports without overwriting paths. */
public interface NoteImportService {
    ImportPreviewResponse preview(String target, List<String> paths, List<MultipartFile> files);

    ImportResultResponse commit(String target, List<String> paths, List<MultipartFile> files,
            String fingerprint, String operation);
}
