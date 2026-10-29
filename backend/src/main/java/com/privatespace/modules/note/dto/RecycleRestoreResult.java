package com.privatespace.modules.note.dto;

import java.util.List;

public record RecycleRestoreResult(int filesRestored, int foldersRestored, List<String> ids) { }
