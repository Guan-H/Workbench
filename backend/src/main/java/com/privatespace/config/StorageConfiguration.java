package com.privatespace.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({StorageProperties.class, RetentionProperties.class, VaultRetentionProperties.class, OfficeProperties.class})
@EnableScheduling
public class StorageConfiguration {
}
