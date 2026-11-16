package com.privatespace.modules.english.service.impl;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.english.dto.EnglishDtos.Word;
import com.privatespace.modules.english.dto.WordImportDtos.*;
import com.privatespace.modules.english.entity.StudyEntities.Item;
import com.privatespace.modules.english.mapper.StudyMapper;
import com.privatespace.modules.english.service.StudyCatalogService;
import com.privatespace.modules.english.service.WordImportService;
import com.privatespace.modules.english.util.WordImportParser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import static com.privatespace.modules.english.util.StudyIdentity.*;

/** Append-only imports use the catalog lock and existing operation receipts to preserve progress. */
@Service
public class WordImportServiceImpl implements WordImportService {
    private final StudyMapper mapper;
    private final StudyCatalogService catalog;
    private final ObjectMapper json;

    public WordImportServiceImpl(StudyMapper mapper, StudyCatalogService catalog, ObjectMapper json) {
        this.mapper = mapper;
        this.catalog = catalog;
        this.json = json;
    }

    public Preview preview(Request request) {
        catalog.synchronize();
        return inspect(request);
    }

    private Preview inspect(Request request) {
        var entries = new ArrayList<Entry>();
        var seen = new HashSet<String>();
        int added = 0, duplicates = 0, invalid = 0;
        for (Entry entry : WordImportParser.parse(request.text())) {
            if (entry.status().equals("invalid")) {
                invalid++;
                entries.add(entry);
                continue;
            }
            String id = wordId(new Word(entry.word(), null, entry.meaning(), null));
            boolean duplicate = !seen.add(id) || mapper.item(id) != null;
            if (duplicate) duplicates++; else added++;
            entries.add(new Entry(entry.line(), entry.word(), entry.meaning(), duplicate ? "duplicate" : "new",
                    duplicate ? "重复词义，跳过且保留原学习记录。" : "将加入词库"));
        }
        return new Preview(List.copyOf(entries), added, duplicates, invalid);
    }

    @Transactional
    public Result save(Request request, String operation) {
        catalog.synchronize();
        mapper.lockState();
        String hash = hash("word-import\n" + request.text());
        var receipt = mapper.operation(operation);
        if (receipt != null) {
            if (!receipt.requestHash().equals(hash)) {
                throw new ApiException(409, "WORD_IMPORT_CHANGED", "同一操作不能用于不同的导入内容。");
            }
            return json.readValue(receipt.responseJson(), Result.class);
        }
        Preview preview = inspect(request);
        if (preview.invalid() > 0) {
            throw new ApiException(400, "WORD_IMPORT_INVALID", "有格式错误的行，请修正后再导入；本次没有写入单词。");
        }
        for (Entry entry : preview.entries()) {
            var word = new Word(entry.word(), null, entry.meaning(), null);
            String id = wordId(word);
            if (entry.status().equals("new")) {
                mapper.insertItem(new Item(id, "word", word.word(), word.meaning(), json.writeValueAsString(word)));
            }
            mapper.markImported(id);
        }
        var result = new Result(preview.newWords(), preview.duplicates());
        mapper.insertOperation(operation, hash, json.writeValueAsString(result));
        return result;
    }
}
