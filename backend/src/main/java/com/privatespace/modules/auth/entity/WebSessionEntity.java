package com.privatespace.modules.auth.entity;

/** Internal session data; the token digest must never enter a response. */
public record WebSessionEntity(String id, String tokenHash, String createdAt, String expiresAt) {
}
