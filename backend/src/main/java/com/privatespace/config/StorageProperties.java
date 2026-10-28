package com.privatespace.config;

import java.nio.file.Path;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Configures the private content volume; no file in this directory is publicly served. */
@ConfigurationProperties("private-space.storage")
public record StorageProperties(Path path) {
}
