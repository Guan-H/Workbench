package com.privatespace.modules.auth.dto;

public record WebSessionResponse(String id, boolean current, String createdAt, String expiresAt) {
}
