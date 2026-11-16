package com.privatespace.modules.english.service;

import com.privatespace.modules.english.dto.ReadingDtos.*;

public interface ReadingSourceService {
    SourceStatus status();
    SourceStatus configure(Configure request);
    SourceStatus sync();
}
