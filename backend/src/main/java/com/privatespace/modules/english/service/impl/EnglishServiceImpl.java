package com.privatespace.modules.english.service.impl;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.*;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.english.dto.EnglishDtos.*;
import com.privatespace.modules.english.entity.*;
import com.privatespace.modules.english.mapper.EnglishMapper;
import com.privatespace.modules.english.service.EnglishService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/** Owns credential rotation and atomic, deduplicated daily snapshots. No note or vault access. */
@Service
public class EnglishServiceImpl implements EnglishService {
    private final EnglishMapper mapper;
    private final ObjectMapper json;
    private final TransactionTemplate transaction;
    public EnglishServiceImpl(EnglishMapper mapper, ObjectMapper json, PlatformTransactionManager manager) {
        this.mapper=mapper; this.json=json; this.transaction=new TransactionTemplate(manager);
    }
    private String digest(byte[] data) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data)); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private boolean authorized(EnglishState state, String token) {
        return token!=null && token.matches("[A-Za-z0-9_-]{43}") && state.enabled() && state.tokenHash()!=null
            && MessageDigest.isEqual(state.tokenHash().getBytes(StandardCharsets.US_ASCII),digest(token.getBytes(StandardCharsets.UTF_8)).getBytes(StandardCharsets.US_ASCII));
    }
    public boolean authenticate(String token) { return authorized(mapper.state(),token); }
    private Status status(EnglishState state) { return new Status(Long.toString(state.revision()),state.tokenHash()!=null,state.enabled()); }
    public Status status() { return status(mapper.state()); }
    public Credential change(Change input) {
        if(input==null || input.baseRevision()==null || input.action()==null) throw invalid();
        return transaction.execute(tx -> {
            EnglishState state=mapper.lock();
            if(!Long.toString(state.revision()).equals(input.baseRevision())) throw new ApiException(409,"WEBHOOK_CONFIG_CHANGED","配置已变化，请刷新核对后重新操作。");
            String hash=state.tokenHash(), token=null; boolean enabled=state.enabled();
            switch(input.action()) {
                case "rotate" -> { byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);hash=digest(token.getBytes(StandardCharsets.UTF_8));enabled=true; }
                case "disable" -> enabled=false;
                case "enable" -> { if(hash==null)throw new ApiException(409,"WEBHOOK_NOT_CONFIGURED","请先生成推送凭证。");enabled=true; }
                default -> throw invalid();
            }
            mapper.configure(hash,enabled);
            return new Credential(status(mapper.state()),token);
        });
    }
    private ApiException invalid() { return new ApiException(400,"INVALID_ENGLISH_PAYLOAD","请核对 requestId、日期、文章和单词字段及数量限制。"); }
    private void text(String value,int max,boolean required) {
        if((required && (value==null || value.isBlank())) || (value!=null && value.length()>max))throw invalid();
    }
    private Submission parse(byte[] body) {
        if(body.length>1024*1024)throw new ApiException(413,"ENGLISH_TOO_LARGE","推送 JSON 最大 1 MiB。");
        Submission input;
        try { var node=json.readTree(body); if(node.has("cet4")||node.has("cet6"))throw invalid();input=json.treeToValue(node,Submission.class); } catch(Exception e) {throw invalid();}
        if(input==null || input.requestId()==null || !input.requestId().matches("[A-Za-z0-9._:-]{1,128}") || input.articles()==null || input.words()==null)throw invalid();
        if(input.date()!=null)date(input.date());
        if(input.articles().size()>10 || input.words().size()>400 || input.articles().size()+input.words().size()==0)throw invalid();
        for(Article a:input.articles()){if(a==null)throw invalid();text(a.title(),200,true);text(a.text(),100000,true);text(a.translation(),100000,false);}
        for(Word w:input.words()){if(w==null)throw invalid();text(w.word(),100,true);text(w.phonetic(),200,false);text(w.meaning(),2000,true);text(w.example(),4000,false);}
        return input;
    }
    public Receipt receive(String token, byte[] body) {
        // Recheck under the same row lock as rotation: old credentials cannot publish after rotation commits.
        var admission=transaction.execute(tx -> {
            var state=mapper.lock();
            if(!authorized(state,token))return "UNAUTHORIZED";
            long minute=Instant.now().getEpochSecond()/60;
            int count=state.minute()==minute?state.requests():0;
            if(count>=60)return "LIMIT";
            mapper.rate(minute,count+1);return "OK";
        });
        if("UNAUTHORIZED".equals(admission))throw new ApiException(401,"WEBHOOK_UNAUTHORIZED","推送凭证无效或入口已停用。");
        if("LIMIT".equals(admission))throw new ApiException(429,"WEBHOOK_RATE_LIMIT","推送过于频繁，请稍后重试。");
        String requestId=null;
        try {
            Submission input=parse(body); requestId=input.requestId();
            return transaction.execute(tx -> {
                if(!authorized(mapper.lock(),token))throw new ApiException(401,"WEBHOOK_UNAUTHORIZED","推送凭证已失效。");
                String hash=digest(json.writeValueAsBytes(input));
                var previous=mapper.receipt(input.requestId());
                if(previous!=null){
                    if(!previous.requestHash().equals(hash))throw new ApiException(409,"WEBHOOK_REQUEST_CONFLICT","同一 requestId 已用于其他内容，请使用新的 requestId。");
                    mapper.log(input.requestId(),"duplicate","OK");return new Receipt(Long.toString(previous.id()),previous.learningDate(),true);
                }
                String learningDate=date(input.date());
                var content=new Submission(input.requestId(),learningDate,input.articles(),input.words());
                mapper.insert(input.requestId(),hash,learningDate,json.writeValueAsString(content));
                mapper.log(input.requestId(),"accepted","OK");
                return new Receipt(Long.toString(mapper.receipt(input.requestId()).id()),learningDate,false);
            });
        } catch(ApiException e) {
            String safeId=requestId;
            transaction.executeWithoutResult(tx -> mapper.log(safeId,"rejected",e.code()));throw e;
        }
    }
    private String date(String input) {
        if(input==null)return LocalDate.now(ZoneId.of("Asia/Shanghai")).toString();
        try {if(!input.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))throw invalid();return LocalDate.parse(input).toString();}
        catch(java.time.DateTimeException e){throw invalid();}
    }
    private int offset(int page){if(page<1||page>1000000)throw new ApiException(400,"INVALID_PAGE","分页参数无效。");return (page-1)*10;}
    private record LegacyContent(String requestId, String date, List<Article> articles, List<Word> cet4, List<Word> cet6) {}

    /** Older persisted snapshots remain readable; new submissions use only the unified words contract. */
    private Submission storedContent(String payload) {
        if (json.readTree(payload).has("words")) {
            return json.readValue(payload, Submission.class);
        }
        LegacyContent old = json.readValue(payload, LegacyContent.class);
        List<Word> words = java.util.stream.Stream.concat(old.cet4().stream(), old.cet6().stream()).toList();
        return new Submission(old.requestId(), old.date(), old.articles(), words);
    }
    private Batch view(EnglishBatch row){return row==null?null:new Batch(Long.toString(row.id()),row.receivedAt().atOffset(ZoneOffset.UTC).toString(),storedContent(row.payload()));}
    public Submission batchContent(long id) {
        EnglishBatch row = mapper.batchById(id);
        if (row == null) throw new ApiException(404, "ENGLISH_BATCH_NOT_FOUND", "该历史批次不存在。");
        return storedContent(row.payload());
    }
    public Daily daily(String input,int page,Long id) {
        String day=date(input);int offset=offset(page);
        return transaction.execute(tx -> {
            var latest=id==null?mapper.latest(day):mapper.batch(id,day);
            if(id!=null&&latest==null)throw new ApiException(404,"ENGLISH_BATCH_NOT_FOUND","该历史批次不存在。");
            var history=mapper.history(day,offset).stream().map(row->new History(Long.toString(row.id()),row.requestId(),row.learningDate(),row.receivedAt().atOffset(ZoneOffset.UTC).toString())).toList();
            return new Daily(day,view(latest),history,mapper.total(day),page);
        });
    }
    public Logs logs(int page){return new Logs(mapper.logs(offset(page)).stream().map(row->new Log(Long.toString(row.id()),row.requestId(),row.status(),row.code(),row.receivedAt().atOffset(ZoneOffset.UTC).toString())).toList(),mapper.logTotal(),page);}
}
