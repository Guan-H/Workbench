package com.privatespace.common.exception;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger LOG = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiProblem> business(ApiException error) {
        return response(ApiProblem.of(error.status(), error.code(), error.getMessage()));
    }

    @ExceptionHandler(DuplicateKeyException.class)
    ResponseEntity<ApiProblem> duplicate() {
        return response(ApiProblem.of(409, "PATH_CONFLICT", "同名对象已存在，请更换名称。"));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class, IllegalArgumentException.class,
            org.springframework.web.bind.ServletRequestBindingException.class,
            org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class})
    ResponseEntity<ApiProblem> invalid() {
        return response(ApiProblem.of(400, "INVALID_REQUEST", "输入格式不正确，请检查后重试。"));
    }

    @ExceptionHandler(org.springframework.web.server.ResponseStatusException.class)
    ResponseEntity<ApiProblem> status(org.springframework.web.server.ResponseStatusException error) {
        return response(ApiProblem.of(error.getStatusCode().value(), "REQUEST_REJECTED", "请求被拒绝。"));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<ApiProblem> oversized() {
        return response(ApiProblem.of(413, "FILE_TOO_LARGE", "文件超过允许大小，请缩小文件后重试。"));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiProblem> unexpected(Exception error) {
        ApiProblem problem = ApiProblem.of(503, "SERVICE_UNAVAILABLE", "服务暂不可用，请稍后重试。");
        LOG.error("Operation {} failed: {}", problem.operationId(), error.getClass().getSimpleName());
        return response(problem);
    }

    private ResponseEntity<ApiProblem> response(ApiProblem problem) {
        return ResponseEntity.status(problem.status()).header("Content-Type", "application/problem+json").body(problem);
    }
}
