package com.privatespace.modules.english.service;

import com.privatespace.modules.english.dto.WordImportDtos;

public interface WordImportService {
    WordImportDtos.Preview preview(WordImportDtos.Request request);
    WordImportDtos.Result save(WordImportDtos.Request request, String operation);
}
