package com.privatespace.modules.auth.dto;

public record AuthStatusResponse(boolean initialized, boolean authenticated, String username) {
}
