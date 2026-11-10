package com.privatespace.modules.document.service.impl;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import com.privatespace.common.exception.ApiException;
import com.privatespace.config.OfficeProperties;
import com.privatespace.modules.auth.service.AuthService;
import com.privatespace.modules.document.entity.OfficeSessionEntity;
import com.privatespace.modules.document.mapper.OfficeMapper;
import com.privatespace.modules.document.service.OfficeService;
import com.privatespace.modules.file.service.FileObjectService;
import com.privatespace.modules.note.dto.NoteResponse;
import com.privatespace.modules.note.service.NoteService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Office owns editing sessions, while NoteService owns every file/revision/change-log publication. */
@Service
public class OfficeServiceImpl implements OfficeService {
    private final OfficeMapper mapper;
    private final NoteService notes;
    private final FileObjectService objects;
    private final AuthService auth;
    private final OfficeProperties properties;
    private final OfficeTokens tokens;
    private final OfficeClient client;
    private final ObjectMapper json;
    private final TransactionTemplate transactions;
    public OfficeServiceImpl(OfficeMapper mapper, NoteService notes, FileObjectService objects, AuthService auth, OfficeProperties properties,
            OfficeTokens tokens, OfficeClient client, ObjectMapper json, PlatformTransactionManager manager) {
        this.mapper=mapper; this.notes=notes; this.objects=objects; this.auth=auth; this.properties=properties; this.tokens=tokens; this.client=client; this.json=json;
        this.transactions=new TransactionTemplate(manager);
    }
    public Map<String,Object> open(String fileId, String baseVersion, String sessionToken) {
        enabled();
        var file=notes.read(fileId,true);
        String extension=extension(file.path());
        if (file.deleted() || !file.type().equals("attachment") || !Set.of("docx","xlsx").contains(extension)) throw new ApiException(400,"OFFICE_FORMAT","请先将旧格式另存转换为 DOCX/XLSX。");
        String id=createSession(file,baseVersion,sessionToken);
        var config=new LinkedHashMap<String,Object>();
        config.put("documentType", extension.equals("docx") ? "word" : "cell");
        config.put("document",Map.of("fileType",extension,"key",id,"title",file.path().substring(file.path().lastIndexOf('/')+1),"url",sourceUrl(id),
                "permissions",Map.of("edit",true,"download",true,"print",true)));
        config.put("editorConfig",Map.of("mode","edit","lang","zh-CN","callbackUrl",properties.callbackBaseUrl()+"/api/v1/office-bridge/"+id+"/callback",
                "user",Map.of("id","owner","name",auth.username()),"customization",Map.of("forcesave",false,"plugins",false,"macros",false,"macrosMode","disable")));
        config.put("token",tokens.sign(config));
        return Map.of("id",id,"hostUrl",properties.browserUrl()+"/web-apps/office-host/index.html","config",config);
    }
    private String createSession(NoteResponse file, String version, String sessionToken) {
        if (!auth.valid(sessionToken)) throw new ApiException(401,"UNAUTHENTICATED","请重新登录。");
        return transactions.execute(tx -> {
            String id=UUID.randomUUID().toString();
            String object=notes.pinVersion(file.id(),version,id);
            mapper.create(id,file.id(),Long.parseLong(version),object,file.path(),digest(sessionToken.getBytes(StandardCharsets.UTF_8)));
            return id;
        });
    }
    private String sourceUrl(String id) {
        String ticket=tokens.sign(Map.of("scope","office-source","session",id,"exp",Instant.now().plusSeconds(43200).getEpochSecond()));
        return properties.callbackBaseUrl()+"/api/v1/office-bridge/"+id+"/source?ticket="+ticket;
    }
    @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 3600000, initialDelay = 3600000)
    public void expireSessions() { if (properties.enabled()) mapper.expire(); }
    public byte[] source(String id, String ticket) {
        var claims=tokens.verify(ticket);
        if (!"office-source".equals(claims.get("scope")) || !id.equals(claims.get("session"))) throw unauthorized();
        var session=valid(mapper.find(id));
        if (notes.read(session.fileId(),false).deleted()) throw unauthorized();
        return objects.read(session.sourceObject());
    }
    public Map<String,Object> status(String id, String token) {
        var session=owned(id,token);
        var result=new LinkedHashMap<String,Object>();
        result.put("id",id); result.put("state",session.state()); result.put("version",Long.toString(session.currentVersion()));
        result.put("pendingSave",session.pendingSave()); result.put("completedSave",session.completedSave()); result.put("errorCode",session.errorCode()); result.put("conflictId",session.conflictId());
        return result;
    }
    public Map<String,Object> save(String id, String token) {
        var session=owned(id,token);
        if (!session.state().equals("OPEN")) throw new ApiException(409,"OFFICE_SESSION_CLOSED","编辑会话已结束或冲突，请保留编辑内容并重新打开文件。");
        String operation=transactions.execute(tx -> {
            var locked=valid(mapper.lock(id));
            if (locked.pendingSave()!=null) return locked.pendingSave();
            String op=UUID.randomUUID().toString(); mapper.pending(id,op); return op;
        });
        var response=client.request("/coauthoring/CommandService.ashx",Map.of("c","forcesave","key",id,"userdata",operation));
        int error=response.path("error").asInt(-1);
        if (error!=0) transactions.executeWithoutResult(tx -> {
            var locked=mapper.lock(id);
            if (operation.equals(locked.pendingSave())) mapper.failed(id,error==4 ? "OFFICE_NO_CHANGES" : "OFFICE_SAVE_FAILED");
        });
        return Map.of("operation",operation,"accepted",error==0);
    }
    public Map<String,Integer> callback(String id, JsonNode body, String authorization) {
        String token=body.path("token").asText(null);
        if (token==null && authorization!=null && authorization.startsWith("Bearer ")) token=authorization.substring(7);
        var claims=tokens.verify(token);
        var signed=json.valueToTree(claims.containsKey("payload") ? claims.get("payload") : claims);
        if (!id.equals(signed.path("key").asText())) throw unauthorized();
        int state=signed.path("status").asInt(-1);
        valid(mapper.find(id));
        if (state==1 || state==4) return Map.of("error",0);
        if (state==3 || state==7) { mapper.failed(id,"OFFICE_ASSEMBLY_FAILED"); return Map.of("error",1); }
        if (state!=2 && state!=6) return Map.of("error",1);
        byte[] bytes=client.download(signed.path("url").asText());
        String hash=digest(bytes);
        return transactions.execute(tx -> {
            var session=valid(mapper.lock(id));
            if (mapper.received(id,hash)>0) return Map.of("error",0);
            if (!session.state().equals("OPEN")) return Map.of("error",1);
            if (state==6 && (session.pendingSave()==null || !session.pendingSave().equals(signed.path("userdata").asText()))) return Map.of("error",1);
            var publication=notes.publishOffice(session.fileId(),session.sourcePath(),Long.toString(session.currentVersion()),bytes,
                    UUID.nameUUIDFromBytes((id+hash).getBytes(StandardCharsets.UTF_8)).toString(), conflictPath(session.sourcePath(),id));
            if (publication.getValue()) mapper.conflict(id,publication.getKey().id());
            else mapper.saved(id,Long.parseLong(publication.getKey().version()),hash,state==2 ? "CLOSED" : "OPEN");
            mapper.receipt(id,hash);
            return Map.of("error",0);
        });
    }
    public NoteResponse convert(String fileId, String baseVersion, String target, String operation, String token) {
        enabled(); var file=notes.read(fileId,false); String old=extension(file.path());
        String format=switch(old) { case "doc" -> "docx"; case "xls" -> "xlsx"; default -> throw new ApiException(400,"OFFICE_FORMAT","仅旧版 DOC/XLS 需要转换另存。"); };
        if (target.equals(file.path()) || !extension(target).equals(format)) throw new ApiException(400,"INVALID_PATH","请选择新的同类型 DOCX/XLSX 路径，原文件保留。");
        String id=createSession(file,baseVersion,token);
        var response=client.request("/converter",Map.of("async",false,"filetype",old,"outputtype",format,"key",id,"url",sourceUrl(id)));
        if (!response.path("endConvert").asBoolean() || response.path("error").asInt(0)!=0) throw new ApiException(422,"OFFICE_CONVERSION_FAILED","文件无法转换，原文件保留；请检查格式或密码保护。");
        byte[] bytes=client.download(response.path("fileUrl").asText());
        return notes.convertedCopy(fileId,baseVersion,target,bytes,operation);
    }
    private OfficeSessionEntity owned(String id, String token) {
        var session=valid(mapper.find(UUID.fromString(id).toString()));
        if (token==null || !session.ownerHash().equals(digest(token.getBytes(StandardCharsets.UTF_8)))) throw unauthorized();
        return session;
    }
    private OfficeSessionEntity valid(OfficeSessionEntity session) {
        enabled();
        if (session==null || !session.valid() || !auth.validSessionHash(session.ownerHash())) throw unauthorized();
        return session;
    }
    private void enabled() { if (!properties.enabled()) throw new ApiException(503,"OFFICE_DISABLED","文档服务尚未启用，请先启动本地文档服务或下载原文件。"); }
    private ApiException unauthorized() { return new ApiException(401,"OFFICE_UNAUTHORIZED","文档会话已失效或未获授权，请重新登录并打开文件。"); }
    private String extension(String path) { return path.substring(path.lastIndexOf('.')+1).toLowerCase(Locale.ROOT); }
    private String conflictPath(String path,String id) { int dot=path.lastIndexOf('.'); String name=path.substring(path.lastIndexOf('/')+1,dot); if (name.length()>100) name=name.substring(0,100); return name+".office-conflict-"+id.substring(0,8)+path.substring(dot); }
    private String digest(byte[] value) { try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value)); } catch (Exception exception) { throw new IllegalStateException(exception); } }
}
