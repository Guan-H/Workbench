package com.privatespace.modules.english.service;
import com.privatespace.modules.english.dto.EnglishDtos.*;
public interface EnglishService {
    boolean authenticate(String token);
    Status status();
    Credential change(Change change);
    Receipt receive(String token, byte[] body);
    Daily daily(String date, int page, Long batch);
    Submission batchContent(long id);
    Logs logs(int page);
}
