package com.privatespace.modules.english.service;

import com.privatespace.modules.english.dto.CourseDtos.Detail;
import com.privatespace.modules.english.dto.ReadingDtos.AddArticle;

public interface ReadingImportService {
    Detail add(AddArticle request, String operation);
    boolean importNasa(String key, String title, String text, String url, String publishedAt);
}
