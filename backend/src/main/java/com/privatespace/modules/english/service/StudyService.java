package com.privatespace.modules.english.service;

/** Operations for persisted English study, implemented inside the existing module. */
public interface StudyService {
    com.privatespace.modules.english.dto.StudyDtos.Settings settings();
    com.privatespace.modules.english.dto.StudyDtos.Settings settings(com.privatespace.modules.english.dto.StudyDtos.ChangeSettings request);
    com.privatespace.modules.english.dto.StudyDtos.Dashboard dashboard();
    com.privatespace.modules.english.dto.StudyDtos.Items items(String kind,String query,boolean wrong,int page);
    com.privatespace.modules.english.dto.StudyDtos.Plan createPlan(String operation);
    com.privatespace.modules.english.dto.StudyDtos.Plan plan(long id);
    com.privatespace.modules.english.dto.StudyDtos.Task translation(String id,com.privatespace.modules.english.dto.StudyDtos.SaveTranslation request,String operation);
    record Round(long planId,long batchId,String activeGame,java.util.List<com.privatespace.modules.english.entity.StudyEntities.Item> items) {}
    Round round(long planId,String mode);
    void attach(String gameId,long planId,java.util.List<com.privatespace.modules.english.dto.EnglishDtos.Word> words,String mode);
    Long gamePlan(String gameId);
    String roundReceipt(String operation,String hash);
    void roundReceipt(String operation,String hash,String gameId);
}
