package com.privatespace.modules.note.dto;

import java.util.List;

/** A page advances over scanned log entries, including entries outside this device's view. */
public record SyncChangePage(String cursor, String until, boolean complete, List<Item> changes) {
    public record Item(String id, NoteResponse file, boolean removed) { }
}
