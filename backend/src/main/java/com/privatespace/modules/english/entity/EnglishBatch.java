package com.privatespace.modules.english.entity;
import java.time.LocalDateTime;
public record EnglishBatch(long id, String requestId, String requestHash, String learningDate, String payload, LocalDateTime receivedAt) {}
