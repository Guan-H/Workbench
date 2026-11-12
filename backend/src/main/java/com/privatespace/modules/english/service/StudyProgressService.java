package com.privatespace.modules.english.service;

/** Operations for persisted English study, implemented inside the existing module. */
public interface StudyProgressService {
    void record(String id,String mode,boolean correct);
    void wordAnswer(String gameId,int choiceId,String mode,boolean correct,com.privatespace.modules.english.dto.EnglishDtos.Word word,long batchId);
}
