package com.privatespace.modules.reader.service;

import com.privatespace.modules.reader.dto.ReadingProgressRequest;
import com.privatespace.modules.reader.dto.ReadingProgressResponse;

/** Single-account reading state is separate from file versions and sync changes. */
public interface ReadingProgressService {
    ReadingProgressResponse read(String fileId);
    ReadingProgressResponse save(String fileId, ReadingProgressRequest request, String operation);
}
