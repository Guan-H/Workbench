package com.privatespace.modules.english.service.impl;

import com.privatespace.modules.english.service.*;
import static com.privatespace.modules.english.util.StudyIdentity.*;
import static com.privatespace.modules.english.util.StudyDates.today;

import java.util.List;
import com.privatespace.modules.english.dto.EnglishDtos.*;
import com.privatespace.modules.english.entity.StudyEntities.Item;
import com.privatespace.modules.english.mapper.EnglishMapper;
import com.privatespace.modules.english.mapper.StudyMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** Incrementally indexes immutable history without editing old payloads or request receipts. */
@Service
public class StudyCatalogServiceImpl implements StudyCatalogService {
    private final EnglishMapper english;
    private final StudyMapper study;
    private final ObjectMapper json;
    public StudyCatalogServiceImpl(EnglishMapper english,StudyMapper study,ObjectMapper json) { this.english=english;this.study=study;this.json=json; }
    @Transactional
    public String word(Word word,long batchId) {
        String id=wordId(word);
        // Most answers refer to an indexed item: avoid taking item/source write locks again.
        // Missing items use the same lock order as history indexing. Later indexing fills all sources.
        if(study.item(id)!=null) return id;
        study.lockState();
        study.insertItem(new Item(id,"word",word.word(),word.meaning(),json.writeValueAsString(word)));
        study.source(id,batchId,-1);
        return id;
    }
    @Transactional
    public void synchronize() {
        long cursor=study.lockState().catalogCursor();
        // A committed batch is indexed exactly once; the cursor and sources commit together.
        while (true) {
            var rows=english.after(cursor);
            if(rows.isEmpty()) break;
            for(var row:rows) {
                var node=json.readTree(row.payload());
                List<Word> words;
                if(node.has("words")) words=json.readValue(node.get("words").toString(),json.getTypeFactory().constructCollectionType(List.class,Word.class));
                else {
                    var old=new java.util.ArrayList<Word>();
                    for(String field:List.of("cet4","cet6")) if(node.has(field)&&!node.get(field).isNull())
                        old.addAll(json.readValue(node.get(field).toString(),json.getTypeFactory().constructCollectionType(List.class,Word.class)));
                    words=old;
                }
                for(Word word:words) {
                    String id=wordId(word);
                    study.insertItem(new Item(id,"word",word.word(),word.meaning(),json.writeValueAsString(word)));
                    study.source(id,row.id(),-1);
                }
                List<Article> articles=json.readValue(node.get("articles").toString(),json.getTypeFactory().constructCollectionType(List.class,Article.class));
                for(int index=0;index<articles.size();index++) {
                    Article article=articles.get(index);
                    if(article.sentences()==null) continue;
                    for(Sentence sentence:article.sentences()) {
                        String id=hash("sentence\n"+normalized(sentence.text())+"\n"+normalized(sentence.translation()));
                        study.insertItem(new Item(id,"sentence",sentence.text(),sentence.translation(),json.writeValueAsString(sentence)));
                        study.source(id,row.id(),index);
                    }
                }
                cursor=row.id();
            }
            study.cursor(cursor);
        }
    }
}
