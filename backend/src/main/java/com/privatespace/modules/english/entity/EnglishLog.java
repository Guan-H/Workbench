package com.privatespace.modules.english.entity;
import java.time.LocalDateTime;
public record EnglishLog(long id, String requestId, String status, String code, LocalDateTime receivedAt) {}
