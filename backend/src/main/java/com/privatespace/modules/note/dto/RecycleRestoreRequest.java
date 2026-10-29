package com.privatespace.modules.note.dto;

import java.util.List;

public record RecycleRestoreRequest(String baseVersion, String mode, List<String> ids,
        String destination, String target, String fingerprint) { }
