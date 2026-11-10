package com.privatespace.modules.reader.dto;
import java.util.List;
import com.privatespace.modules.note.dto.NoteResponse;
public record NovelLibraryResponse(String revision, List<Folder> folders, List<Book> books) {
    public record Folder(String id,String parentId,String name) { }
    public record Book(String fileId, String folderId, String sourcePath, NoteResponse file) { }
}
