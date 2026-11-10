package com.privatespace.modules.reader.service;
import java.util.Map;
import com.privatespace.modules.reader.dto.NovelLibraryRequest;
import com.privatespace.modules.reader.dto.NovelLibraryResponse;
import com.privatespace.modules.note.dto.NoteResponse;
public interface NovelLibraryService {
    NovelLibraryResponse list();
    NoteResponse source(String id);
    Map<String,String> change(NovelLibraryRequest request,String operation);
    Map<String,String> upload(String revision,String parent,String name,byte[] bytes,String operation);
}
