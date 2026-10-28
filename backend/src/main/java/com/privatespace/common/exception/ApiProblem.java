package com.privatespace.common.exception;

import java.util.UUID;

public record ApiProblem(String type, String title, int status, String code, String operationId) {
    public static ApiProblem of(int status, String code, String title) {
        return new ApiProblem("about:blank", title, status, code, UUID.randomUUID().toString());
    }
}
