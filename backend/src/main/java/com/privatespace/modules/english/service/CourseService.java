package com.privatespace.modules.english.service;

import com.privatespace.modules.english.dto.CourseDtos.*;

public interface CourseService {
    Page list(int page, String filter);
    SentencePage sentences(int page, boolean markedOnly);
    Detail detail(String id);
    Detail change(String id, Change request, String operation);
}
