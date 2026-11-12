package com.privatespace.modules.english.service.impl;

import com.privatespace.modules.english.service.*;
import static com.privatespace.modules.english.util.StudyIdentity.*;
import static com.privatespace.modules.english.util.StudyDates.today;

import java.time.LocalDate;
import com.privatespace.modules.english.entity.StudyEntities.Progress;
import com.privatespace.modules.english.mapper.StudyMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Spaced practice advances at most once per Beijing date; same-day repetitions are not mastery. */
@Service
public class StudyProgressServiceImpl implements StudyProgressService {
    private final StudyMapper mapper;
    private final StudyCatalogService catalog;
    public StudyProgressServiceImpl(StudyMapper mapper,StudyCatalogService catalog) { this.mapper=mapper;this.catalog=catalog; }
    @Transactional
    public void record(String id,String mode,boolean correct) {
        mapper.ensureProgress(id,mode);
        Progress old=mapper.lockProgress(id,mode);
        LocalDate today=today();
        int stage=old.stage(),mistakes=old.mistakes();
        LocalDate wrong=old.wrongDate();
        if(!correct) { stage=0;mistakes++;wrong=today; }
        else if((old.lastDate()==null||old.lastDate().isBefore(today))&&!today.equals(wrong)) stage=Math.min(4,stage+1);
        int[] intervals={1,1,3,7,14};
        mapper.saveProgress(new Progress(id,mode,stage,mistakes,today,wrong,today.plusDays(intervals[stage])));
    }
    @Transactional
    public void wordAnswer(String gameId,int choiceId,String mode,boolean correct,com.privatespace.modules.english.dto.EnglishDtos.Word word,long batchId) {
        String id=mapper.gameItem(gameId,choiceId);
        if(id==null) id=catalog.word(word,batchId);
        record(id,mode,correct);
        if(correct) mapper.completeWord(gameId,id,mode);
    }
}
