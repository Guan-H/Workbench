package com.privatespace.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Disabled by default; the dedicated document service is configured explicitly for each environment. */
@ConfigurationProperties("private-space.office")
public record OfficeProperties(boolean enabled, String serverUrl, String browserUrl, String callbackBaseUrl, String jwtSecret) {}
