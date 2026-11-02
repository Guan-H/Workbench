package com.privatespace.modules.sync.dto;

import java.util.List;

/** Empty roots means the whole library; selected roots retain their library-relative paths. */
public record SyncScope(boolean all, List<String> folders) {
    public static SyncScope entireLibrary() {
        return new SyncScope(true, List.of());
    }
}
