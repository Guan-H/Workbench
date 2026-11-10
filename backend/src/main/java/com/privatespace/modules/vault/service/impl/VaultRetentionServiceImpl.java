package com.privatespace.modules.vault.service.impl;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;

import com.privatespace.config.VaultRetentionProperties;
import com.privatespace.modules.vault.mapper.VaultMapper;
import com.privatespace.modules.vault.service.VaultRetentionService;
import com.privatespace.modules.vault.dto.VaultRetentionPolicy;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Prunes opaque history only. Deleted entries remain encrypted and require client confirmation. */
@Service
public class VaultRetentionServiceImpl implements VaultRetentionService {
    private final VaultRetentionProperties properties;
    private final VaultMapper mapper;
    private final TransactionTemplate transactions;
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(VaultRetentionServiceImpl.class);

    public VaultRetentionServiceImpl(VaultRetentionProperties properties, VaultMapper mapper, PlatformTransactionManager manager) {
        this.properties = properties; this.mapper = mapper; this.transactions = new TransactionTemplate(manager);
    }

    public VaultRetentionPolicy policy() {
        var now = Instant.now();
        return new VaultRetentionPolicy(properties.isEnabled(), properties.getHistoryDays(), properties.getRecycleDays(), now.toString(), now.minus(properties.getRecycleDays(), ChronoUnit.DAYS).toString());
    }

    public int cleanup() {
        if (!properties.isEnabled()) return 0;
        int removed = transactions.execute(status -> {
            if (mapper.lockAccount() != 1) return 0;
            var current = mapper.snapshot();
            return current == null ? 0 : mapper.pruneHistory(current.vaultId(), current.version(), LocalDateTime.now(ZoneOffset.UTC).minusDays(properties.getHistoryDays()));
        });
        return removed;
    }

    @Scheduled(fixedDelayString = "${private-space.vault-retention.cleanup-interval:PT6H}", initialDelayString = "${private-space.vault-retention.cleanup-initial-delay:PT1M}")
    public void scheduledCleanup() {
        try { int count = cleanup(); if (count > 0) LOG.info("Removed {} expired vault history snapshots; current version retained", count); }
        catch (RuntimeException exception) { LOG.error("Vault history cleanup failed; no success reported", exception); }
    }
}
