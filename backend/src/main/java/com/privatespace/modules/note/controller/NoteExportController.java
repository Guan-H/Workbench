package com.privatespace.modules.note.controller;

import java.io.IOException;
import java.nio.file.Files;
import java.time.LocalDate;
import java.time.ZoneOffset;

import com.privatespace.modules.note.service.NoteExportService;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

@RestController
@RequestMapping("/api/v1/note-exports")
public class NoteExportController {
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(NoteExportController.class);
    private final NoteExportService exports;

    public NoteExportController(NoteExportService exports) { this.exports = exports; }

    @GetMapping
    public void download(HttpServletResponse response) throws IOException {
        send(exports.archive(), response);
    }

    public record Selection(boolean all, java.util.List<String> ids) { }

    @PostMapping
    public void selected(@RequestBody Selection selection, HttpServletResponse response) throws IOException {
        send(exports.archive(selection.all(), selection.ids()), response);
    }

    private void send(java.nio.file.Path archive, HttpServletResponse response) throws IOException {
        try {
            response.setContentType("application/zip");
            response.setHeader("Content-Disposition", "attachment; filename=\"private-space-notes-" + LocalDate.now(ZoneOffset.UTC) + ".zip\"");
            response.setHeader("Cache-Control", "no-store");
            response.setHeader("X-Content-Type-Options", "nosniff");
            response.setContentLengthLong(Files.size(archive));
            Files.copy(archive, response.getOutputStream());
        } finally {
            try { Files.deleteIfExists(archive); }
            catch (IOException exception) { LOG.warn("Downloaded ZIP temporary cleanup failed; local storage maintenance required"); }
        }
    }
}
