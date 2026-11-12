package com.privatespace.modules.english.service;

/** Operations for persisted English study, implemented inside the existing module. */
public interface StudyCatalogService {
    String word(com.privatespace.modules.english.dto.EnglishDtos.Word word,long batchId);
    void synchronize();
}
