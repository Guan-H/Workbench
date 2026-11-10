package com.privatespace.modules.reader.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
public record NovelLibraryRequest(@NotBlank @Pattern(regexp="0|[1-9][0-9]{0,17}") String baseRevision,
        @NotBlank @Pattern(regexp="create-folder|update-folder|delete-folder|add-book|move-book|remove-book") String action,
        @Size(max=36) String id, @Size(max=36) String parentId, @Size(max=120) String name) { }
