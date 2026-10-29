package com.privatespace.modules.note.service;

import java.nio.file.Path;

/** Builds an ordinary-file snapshot before starting the authenticated download. Caller deletes the temporary ZIP. */
public interface NoteExportService {
    Path archive();
    Path archive(boolean all, java.util.List<String> ids);
}
