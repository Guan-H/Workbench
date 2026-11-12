package com.privatespace.modules.reader.service.impl;

import java.security.MessageDigest;
import java.util.*;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.note.dto.NoteResponse;
import com.privatespace.modules.note.service.NoteService;
import com.privatespace.modules.reader.dto.*;
import com.privatespace.modules.reader.entity.NovelFolderEntity;
import com.privatespace.modules.reader.mapper.NovelLibraryMapper;
import com.privatespace.modules.reader.service.NovelLibraryService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** The novel tree only owns folders and references. NoteService remains the sole owner of source bytes. */
@Service
public class NovelLibraryServiceImpl implements NovelLibraryService {
    private final NovelLibraryMapper mapper;
    private final NoteService notes;
    private final ObjectMapper json;
    public NovelLibraryServiceImpl(NovelLibraryMapper mapper,NoteService notes,ObjectMapper json) { this.mapper=mapper; this.notes=notes; this.json=json; }
    public static boolean supported(NoteResponse file) {
        String path=file.path().toLowerCase(Locale.ROOT);
        return !file.deleted() && ((file.type().equals("note") && path.endsWith(".md")) || (file.type().equals("attachment") && path.matches(".*\\.(txt|epub)$")));
    }
    @Transactional(readOnly=true)
    public NovelLibraryResponse list() {
        var references = mapper.books();
        // Resolve only referenced metadata in one query, never the whole notebook or source bytes.
        var sources = new HashMap<String, NoteResponse>();
        notes.metadataBatch(references.stream().map(book -> book.fileId()).toList())
                .stream().filter(NovelLibraryServiceImpl::supported).forEach(file -> sources.put(file.id(), file));
        var books=references.stream().map(book -> {
            NoteResponse file=sources.get(book.fileId());
            return new NovelLibraryResponse.Book(book.fileId(),book.folderId(),book.sourcePath(),file);
        }).toList();
        return new NovelLibraryResponse(Long.toString(mapper.revision()),mapper.folders().stream().map(item->new NovelLibraryResponse.Folder(item.id(),item.parentId(),item.name())).toList(),books);
    }
    public NoteResponse source(String id) {
        if (mapper.book(id)==null) throw new ApiException(404,"NOVEL_NOT_ADDED","该文件尚未加入书籍，请在笔记中右键选择复制到书架。");
        var file=notes.metadata(id);
        if (!supported(file)) throw new ApiException(404,"NOVEL_SOURCE_UNAVAILABLE","源文件已删除或格式已变化，恢复源文件后可继续阅读。");
        return file;
    }
    private String folder(String id) {
        String value=id==null ? "" : id;
        if (!value.isEmpty() && mapper.folders().stream().noneMatch(item -> item.id().equals(value))) throw new ApiException(409,"NOVEL_FOLDER_CHANGED","书籍目录已变化，请刷新后重新选择。");
        return value;
    }
    private String name(String name) {
        if (name==null || name.isBlank() || !name.equals(name.trim()) || name.length()>120 || name.matches(".*[/\\\\\u0000-\u001f].*") || Set.of(".","..").contains(name)) throw new ApiException(400,"INVALID_NAME","请输入不含斜线的有效名称，最多 120 字。");
        return name;
    }
    private String hash(Object request) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(json.writeValueAsBytes(request))); }
        catch (Exception exception) { throw new IllegalStateException(exception); }
    }
    @SuppressWarnings("unchecked")
    private Map<String,String> begin(String revision,String operation,String hash) {
        try { UUID.fromString(operation); } catch (RuntimeException exception) { throw new ApiException(400,"INVALID_OPERATION","操作标识无效。"); }
        long current=mapper.lock();
        var previous=mapper.operationHash(operation);
        if (previous!=null) {
            if (!previous.equals(hash)) throw new ApiException(409,"OPERATION_REUSED","该操作已用于其他内容。");
            return json.readValue(mapper.operationResult(operation),Map.class);
        }
        if (!Long.toString(current).equals(revision)) throw new ApiException(409,"NOVEL_LIBRARY_CHANGED","书籍目录已变化，请刷新并重新确认。");
        return null;
    }
    private Map<String,String> finish(String operation,String hash,String id) {
        mapper.advance();
        var result=Map.of("revision",Long.toString(mapper.revision()),"id",id);
        mapper.receipt(operation,hash,json.writeValueAsString(result)); return result;
    }
    @Transactional
    public Map<String,String> change(NovelLibraryRequest request,String operation) {
        String hash=hash(request); var previous=begin(request.baseRevision(),operation,hash); if(previous!=null) return previous;
        String id=request.id()==null ? "" : request.id(), parent;
        switch(request.action()) {
            case "create-folder" -> {
                parent=folder(request.parentId()); String label=name(request.name());
                if (mapper.folders().size()>=5000) throw new ApiException(413,"NOVEL_LIMIT","书籍目录最多 5000 个。");
                unique(parent,label,""); id=UUID.randomUUID().toString(); mapper.createFolder(id,parent,label);
            }
            case "update-folder" -> {
                var current=requiredFolder(id); parent=folder(request.parentId()); String label=name(request.name());
                String ancestor=parent; int depth=0;
                while (!ancestor.isEmpty()) {
                    if (ancestor.equals(current.id()) || ++depth>256) throw new ApiException(400,"NOVEL_FOLDER_CYCLE","不能移到自身或子目录。");
                    ancestor=requiredFolder(ancestor).parentId();
                }
                unique(parent,label,id); mapper.updateFolder(id,parent,label);
            }
            case "delete-folder" -> {
                requiredFolder(id); var descendants=new LinkedHashSet<String>(); descendants.add(id);
                boolean changed;
                do { changed=false; for (var item:mapper.folders()) if(descendants.contains(item.parentId())) changed|=descendants.add(item.id()); } while(changed);
                for(String child:descendants) { mapper.removeFolderBooks(child); mapper.deleteFolder(child); }
            }
            case "add-book" -> {
                parent=folder(request.parentId()); var file=notes.metadata(id);
                if (!supported(file)) throw new ApiException(400,"NOVEL_FORMAT","仅支持 TXT、EPUB 和 Markdown 笔记。");
                if (mapper.book(id)!=null) throw new ApiException(409,"NOVEL_ALREADY_ADDED","该文件已在书籍目录中，不会复制正文；请到阅读页移动分类。");
                if(mapper.books().size()>=5000) throw new ApiException(413,"NOVEL_LIMIT","书籍书目最多 5000 本。");
                mapper.add(id,parent,file.path());
            }
            case "move-book" -> { parent=folder(request.parentId()); if(mapper.book(id)==null) throw new ApiException(404,"NOT_FOUND","书目不存在。"); mapper.move(id,parent); }
            case "remove-book" -> { if(mapper.book(id)==null) throw new ApiException(404,"NOT_FOUND","书目不存在。"); mapper.remove(id); }
            default -> throw new ApiException(400,"INVALID_ACTION","书籍操作无效。");
        }
        return finish(operation,hash,id);
    }
    private NovelFolderEntity requiredFolder(String id) { return mapper.folders().stream().filter(item->item.id().equals(id)).findFirst().orElseThrow(()->new ApiException(404,"NOT_FOUND","书籍目录不存在。")); }
    private void unique(String parent,String name,String except) {
        if(mapper.folders().stream().anyMatch(item->!item.id().equals(except) && item.parentId().equals(parent) && item.name().equalsIgnoreCase(name))) throw new ApiException(409,"PATH_CONFLICT","同级书籍目录已重名。");
    }
    @Transactional
    public Map<String,String> upload(String revision,String parent,String filename,byte[] bytes,String operation) {
        String bytesHash;
        try { bytesHash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); } catch(Exception exception) { throw new IllegalStateException(exception); }
        String hash=hash(List.of(revision,parent,filename,bytesHash)); var previous=begin(revision,operation,hash); if(previous!=null) return previous;
        folder(parent);
        if (!filename.toLowerCase(Locale.ROOT).matches("[^/\\\\]+\\.(txt|epub|md)$")) throw new ApiException(400,"NOVEL_FORMAT","请选择 TXT、EPUB 或 Markdown 文件。");
        if(mapper.books().size()>=5000) throw new ApiException(413,"NOVEL_LIMIT","书籍书目最多 5000 本。");
        NoteResponse file;
        if(filename.toLowerCase(Locale.ROOT).endsWith(".md")) {
            String text;
            try { text=java.nio.charset.StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)).toString(); }
            catch(java.nio.charset.CharacterCodingException exception) { throw new ApiException(422,"INVALID_UTF8","Markdown 必须为 UTF-8。"); }
            file=notes.create(new com.privatespace.modules.note.dto.WriteNoteRequest(filename,"note",text,null),operation);
        } else file=notes.upload(filename,bytes,operation);
        if (!supported(file)) throw new ApiException(400,"NOVEL_FORMAT","文件格式不支持。");
        mapper.add(file.id(),parent,file.path()); return finish(operation,hash,file.id());
    }
}
