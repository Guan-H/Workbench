package com.privatespace.modules.english.util;

import java.util.ArrayList;
import java.util.List;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.english.dto.WordImportDtos.Entry;

/** Reads one explicit word/meaning pair per line; does not infer vocabulary from prose. */
public final class WordImportParser {
    private WordImportParser() {}

    public static List<Entry> parse(String text) {
        var result = new ArrayList<Entry>();
        String[] lines = text.replace("\uFEFF", "").split("\\R", -1);
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i].strip();
            if (line.isEmpty()) continue;
            if (result.size() >= 500) {
                throw new ApiException(400, "WORD_IMPORT_LIMIT", "每次最多导入 500 行单词，请分批导入。");
            }
            int separator = line.indexOf(':');
            int chinese = line.indexOf('：');
            if (separator < 0 || (chinese >= 0 && chinese < separator)) separator = chinese;
            String word = separator < 0 ? line : line.substring(0, separator).strip();
            String meaning = separator < 0 ? "" : line.substring(separator + 1).strip();
            String error = null;
            if (separator < 0 || word.isBlank() || meaning.isBlank()) error = "请按“单词：释义”填写，两边都不能为空。";
            else if (word.length() > 100 || meaning.length() > 4000) error = "单词最多 100 字符，释义最多 4000 字符。";
            else if (!word.matches("[A-Za-z][A-Za-z '\u2019\\-]*")) error = "英文单词或短语可含字母、空格、连字符和撇号。";
            result.add(new Entry(i + 1, word, meaning, error == null ? "new" : "invalid", error));
        }
        if (result.isEmpty()) throw new ApiException(400, "WORD_IMPORT_EMPTY", "请至少填写一行“单词：释义”。");
        return List.copyOf(result);
    }
}
