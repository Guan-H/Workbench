package com.privatespace.modules.english.service.impl;

import java.net.URI;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.english.dto.CourseDtos.Content;
import com.privatespace.modules.english.dto.CourseDtos.Detail;
import com.privatespace.modules.english.dto.EnglishDtos.Article;
import com.privatespace.modules.english.dto.ReadingDtos.*;
import com.privatespace.modules.english.entity.CourseEntity;
import com.privatespace.modules.english.mapper.CourseMapper;
import com.privatespace.modules.english.service.CourseService;
import com.privatespace.modules.english.service.ReadingImportService;
import com.privatespace.modules.english.util.StudyIdentity;

@Service
public class ReadingImportServiceImpl implements ReadingImportService {
    private final CourseMapper mapper;
    private final CourseService courses;
    private final ObjectMapper json;
    public ReadingImportServiceImpl(CourseMapper mapper, CourseService courses, ObjectMapper json) {
        this.mapper = mapper; this.courses = courses; this.json = json;
    }

    @Transactional
    public Detail add(AddArticle request, String operation) {
        String url = validateUrl(request.sourceUrl());
        String hash = StudyIdentity.hash(json.writeValueAsString(request));
        String id = "manual-" + operation;
        Content content = new Content(new Article(request.title(), request.text(), blankToNull(request.translation())),
                List.of(), List.of(), List.of(), new Origin("manual", url, null, "自行添加", null));
        mapper.insert(new CourseEntity(id, request.title(), "自行添加 · 未分级", "自行添加",
                json.writeValueAsString(content), "manual", operation, hash));
        var existing = mapper.course(id);
        if (existing == null || !hash.equals(existing.requestHash())) {
            throw new ApiException(409, "READING_OPERATION_REUSED", "这次操作已用于其他文章，请保留内容后重新添加。");
        }
        return courses.detail(id);
    }

    /** Immutable source identity deduplicates repeated pulls without overwriting saved text or progress. */
    @Transactional
    public boolean importNasa(String key, String title, String text, String url, String publishedAt) {
        Content content = new Content(new Article(title, text, null), List.of(), List.of(), List.of(),
                new Origin("nasa", validateUrl(url), publishedAt, "NASA", "https://www.nasa.gov/nasa-brand-center/images-and-media/"));
        return mapper.insert(new CourseEntity("nasa-" + key.substring(0, 48), title, "原版科普 · 未分级", "NASA · 原文资料",
                json.writeValueAsString(content), "nasa", key, null)) == 1;
    }

    private String blankToNull(String text) { return text == null || text.isBlank() ? null : text; }

    private String validateUrl(String input) {
        String value = blankToNull(input);
        if (value == null) return null;
        try {
            URI url = URI.create(value);
            if (!List.of("http", "https").contains(url.getScheme()) || url.getHost() == null || url.getUserInfo() != null) {
                throw new IllegalArgumentException();
            }
            return value;
        } catch (IllegalArgumentException exception) {
            throw new ApiException(400, "INVALID_READING_SOURCE_URL", "来源链接请使用不含账号密码的 HTTP 或 HTTPS 地址。");
        }
    }
}
