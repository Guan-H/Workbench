package com.privatespace.modules.english.service.impl;

import com.privatespace.modules.english.service.*;
import static com.privatespace.modules.english.util.StudyIdentity.*;
import static com.privatespace.modules.english.util.StudyDates.today;

import java.util.List;
import java.util.UUID;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.english.dto.EnglishDtos.Word;
import com.privatespace.modules.english.dto.StudyDtos;
import com.privatespace.modules.english.entity.StudyEntities;
import com.privatespace.modules.english.mapper.StudyMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** Owns fixed daily plans, vocabulary browsing and explicitly self-assessed translation tasks. */
@Service
public class StudyServiceImpl implements StudyService {
    private final StudyMapper mapper;
    private final StudyCatalogService catalog;
    private final StudyProgressService progress;
    private final ObjectMapper json;
    public StudyServiceImpl(StudyMapper mapper,StudyCatalogService catalog,StudyProgressService progress,ObjectMapper json) {
        this.mapper=mapper;this.catalog=catalog;this.progress=progress;this.json=json;
    }
    public StudyDtos.Settings settings() {
        var state=mapper.state();
        return new StudyDtos.Settings(Long.toString(state.revision()),state.newLimit(),state.reviewLimit(),state.sentenceLimit());
    }
    public StudyDtos.Dashboard dashboard() {
        catalog.synchronize();
        return new StudyDtos.Dashboard(settings(),mapper.total("word","",false),mapper.total("sentence","",false),
                mapper.total("word","",true),mapper.due(today()),view(mapper.plan(today())));
    }
    @Transactional
    public StudyDtos.Settings settings(StudyDtos.ChangeSettings request) {
        var state=mapper.lockState();
        if(!Long.toString(state.revision()).equals(request.baseRevision())) throw conflict("学习设置已变化，请刷新核对。");
        mapper.settings(request.newLimit(),request.reviewLimit(),request.sentenceLimit());
        return settings();
    }
    public StudyDtos.Items items(String kind,String query,boolean wrong,int page) {
        if(!List.of("word","sentence").contains(kind)||query.length()>200||page<1||page>100000) throw invalid();
        catalog.synchronize();
        var items=mapper.items(kind,query,wrong,(page-1)*10).stream().map(item->new StudyDtos.Item(item.id(),item.kind(),item.name(),item.meaning(),
                item.kind().equals("word")?json.readValue(item.payload(),Word.class):null,
                mapper.sources(item.id()).stream().map(source->new StudyDtos.Source(Long.toString(source.batchId()),source.date(),source.articleIndex())).toList(),
                mapper.progress(item.id()).stream().map(p->new StudyDtos.Progress(p.mode(),p.stage(),p.mistakes(),p.nextDate()==null?null:p.nextDate().toString())).toList())).toList();
        return new StudyDtos.Items(items,mapper.total(kind,query,wrong),page);
    }
    @Transactional
    public StudyDtos.Plan createPlan(String operation) {
        catalog.synchronize();
        var settings=mapper.lockState();
        var previous=mapper.planOperation(operation);
        if(previous!=null) return view(previous);
        var today=today();
        previous=mapper.plan(today);
        if(previous!=null) return view(previous);
        mapper.insertPlan(today,operation,settings.newLimit(),settings.reviewLimit(),settings.sentenceLimit());
        var plan=mapper.plan(today);
        for(var due:mapper.dueWords(today,settings.reviewLimit())) addTask(plan.id(),due.itemId(),due.mode(),"review");
        for(var item:mapper.newWords(settings.newLimit())) {
            var modes=mapper.progress(item.id()).stream().map(StudyEntities.Progress::mode).toList();
            for(String mode:List.of("matching","spelling")) if(!modes.contains(mode)) addTask(plan.id(),item.id(),mode,"new");
        }
        for(String mode:List.of("en-zh","zh-en")) for(var item:mapper.sentences(today,mode,settings.sentenceLimit())) addTask(plan.id(),item.id(),mode,"sentence");
        mapper.anchor(plan.id());
        return view(mapper.plan(today));
    }
    private void addTask(long planId,String itemId,String mode,String kind) {
        mapper.task(UUID.randomUUID().toString(),planId,itemId,mode,kind);
    }
    public StudyDtos.Plan plan(long id) { return view(require(mapper.lockPlan(id))); }
    private StudyEntities.Plan require(StudyEntities.Plan plan) {
        if(plan==null) throw new ApiException(404,"STUDY_PLAN_NOT_FOUND","学习计划不存在。");
        return plan;
    }
    private StudyDtos.Plan view(StudyEntities.Plan plan) {
        if(plan==null) return null;
        var tasks=mapper.tasks(plan.id());
        var words=tasks.stream().filter(task->List.of("matching","spelling").contains(task.mode())).map(StudyEntities.Task::itemId).distinct()
                .map(mapper::item).map(item->json.readValue(item.payload(),Word.class)).toList();
        return new StudyDtos.Plan(Long.toString(plan.id()),plan.learningDate().toString(),plan.anchorBatchId()==null?null:plan.anchorBatchId().toString(),
                plan.newLimit(),plan.reviewLimit(),plan.sentenceLimit(),tasks.stream().map(this::taskView).toList(),words,
                mapper.activeGame(plan.id(),"matching"),mapper.activeGame(plan.id(),"spelling"));
    }
    private StudyDtos.Task taskView(StudyEntities.Task task) {
        var item=mapper.item(task.itemId());
        boolean toChinese=task.mode().equals("en-zh");
        boolean sentence=task.kind().equals("sentence");
        String prompt=sentence?(toChinese?item.name():item.meaning()):item.name();
        String reference=sentence&&task.submitted()?(toChinese?item.meaning():item.name()):null;
        return new StudyDtos.Task(task.id(),task.itemId(),task.mode(),task.kind(),task.completed(),Long.toString(task.revision()),prompt,
                reference,task.answer(),task.submitted(),task.rating(),task.gameId(),mapper.sources(item.id()).stream()
                        .map(source->new StudyDtos.Source(Long.toString(source.batchId()),source.date(),source.articleIndex())).toList());
    }
    @Transactional
    public StudyDtos.Task translation(String id,StudyDtos.SaveTranslation request,String operation) {
        var task=mapper.lockTask(id);
        if(task==null||!task.kind().equals("sentence")) throw new ApiException(404,"STUDY_TASK_NOT_FOUND","短句练习不存在。");
        String hash=hash(id+"\n"+json.writeValueAsString(request));
        var receipt=mapper.operation(operation);
        if(receipt!=null) {
            if(!receipt.requestHash().equals(hash)) throw conflict("同一操作不能提交不同内容。");
            return json.readValue(receipt.responseJson(),StudyDtos.Task.class);
        }
        if(!Long.toString(task.revision()).equals(request.baseRevision())) throw conflict("练习已被其他页面更新，请重新读取；本机输入保留。");
        if(task.completed()) throw conflict("这项练习已完成，请查看保存结果。");
        boolean submitted=task.submitted(),completed=false;
        String rating=null;
        switch(request.action()) {
            case "draft" -> { if(submitted||request.rating()!=null) throw invalid(); }
            case "submit" -> { if(submitted||request.answer().isBlank()||request.rating()!=null) throw invalid();submitted=true; }
            case "rate" -> {
                if(!submitted||request.rating()==null||!request.answer().equals(task.answer())) throw invalid();
                rating=request.rating();completed=true;
                progress.record(task.itemId(),task.mode(),rating.equals("good"));
            }
            default -> throw invalid();
        }
        mapper.translation(id,request.answer(),submitted,rating,completed);
        var response=taskView(mapper.lockTask(id));
        mapper.insertOperation(operation,hash,json.writeValueAsString(response));
        return response;
    }
    /** Called inside the word-game transaction, with the plan locked before allocating a new round. */
    public Round round(long planId,String mode) {
        var plan=require(mapper.lockPlan(planId));
        if(!plan.learningDate().equals(today())) throw conflict("旧计划只允许继续已有轮次，请生成今天的计划。");
        String active=mapper.activeGame(planId,mode);
        if(active!=null) return new Round(planId,plan.anchorBatchId(),active,List.of());
        var pending=mapper.tasks(planId).stream().filter(task->task.mode().equals(mode)&&!task.completed()).toList();
        boolean reviewing=pending.stream().anyMatch(task->task.kind().equals("review"));
        var items=pending.stream().filter(task->!reviewing||task.kind().equals("review")).map(task->mapper.item(task.itemId())).toList();
        if(items.isEmpty()) throw new ApiException(409,"NO_PRACTICE_WORDS","本计划该模式已完成，或没有可练习的词汇。");
        return new Round(planId,plan.anchorBatchId(),null,items);
    }
    public void attach(String gameId,long planId,List<Word> words,String mode) {
        for(int i=0;i<words.size();i++) {
            String id=wordId(words.get(i));
            mapper.gameWord(gameId,i,id,planId);
            mapper.attachGame(planId,id,mode,gameId);
        }
    }
    public Long gamePlan(String gameId) { return mapper.gamePlan(gameId); }
    public String roundReceipt(String operation,String hash) {
        var receipt=mapper.operation(operation);
        if(receipt==null) return null;
        if(!receipt.requestHash().equals(hash)) throw conflict("同一操作不能用于不同练习。");
        return json.readTree(receipt.responseJson()).get("gameId").asString();
    }
    public void roundReceipt(String operation,String hash,String gameId) {
        if(roundReceipt(operation,hash)==null) mapper.insertOperation(operation,hash,json.writeValueAsString(java.util.Map.of("gameId",gameId)));
    }
    private ApiException invalid() { return new ApiException(400,"INVALID_STUDY_REQUEST","请核对学习参数、译文及自评步骤。"); }
    private ApiException conflict(String message) { return new ApiException(409,"STUDY_CHANGED",message); }
}
