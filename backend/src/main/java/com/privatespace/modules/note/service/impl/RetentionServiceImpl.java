package com.privatespace.modules.note.service.impl;

import java.time.LocalDateTime;
import java.time.ZoneOffset;

import com.privatespace.config.RetentionProperties;
import com.privatespace.modules.file.mapper.FileObjectMapper;
import com.privatespace.modules.file.service.FileObjectService;
import com.privatespace.modules.note.mapper.NoteMapper;
import com.privatespace.modules.note.mapper.RetentionMapper;
import com.privatespace.modules.note.service.RetentionService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class RetentionServiceImpl implements RetentionService {
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(RetentionServiceImpl.class);
    private static final int METADATA_BATCH = 2_000;
    private final RetentionProperties properties;
    private final NoteMapper notes;
    private final RetentionMapper retention;
    private final FileObjectMapper objectMapper;
    private final FileObjectService objects;
    private final TransactionTemplate transactions;

    public RetentionServiceImpl(RetentionProperties properties, NoteMapper notes, RetentionMapper retention,
            FileObjectMapper objectMapper, FileObjectService objects, PlatformTransactionManager manager) {
        this.properties = properties;
        this.notes = notes;
        this.retention = retention;
        this.objectMapper = objectMapper;
        this.objects = objects;
        this.transactions = new TransactionTemplate(manager);
    }

    @Override
    public CleanupResult cleanup() {
        if (!properties.isEnabled()) return new CleanupResult(0, 0, 0, 0);
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);
        LocalDateTime recycleCutoff = now.minusDays(properties.getRecycleDays());
        LocalDateTime historyCutoff = now.minusDays(properties.getHistoryDays());
        int[] metadata = transactions.execute(status -> {
            notes.lock();
            objectMapper.releaseExpired();
            removeCompletedBatches(recycleCutoff);
            int trashFiles = 0;
            for (String id : retention.expiredTrash(recycleCutoff, METADATA_BATCH)) {
                retention.deleteMemberReferences(id);
                retention.deleteFileRevisions(id);
                trashFiles += retention.deleteTrashFile(id, recycleCutoff);
            }
            removeCompletedBatches(recycleCutoff);
            int revisions = 0;
            for (var revision : retention.expiredRevisions(historyCutoff, METADATA_BATCH)) {
                revisions += retention.deleteRevision(revision.fileId(), revision.version(), historyCutoff);
            }
            return new int[]{trashFiles, revisions};
        });
        LocalDateTime orphanCutoff = now.minusDays(properties.getOrphanDays());
        int databaseObjects = 0;
        for (String id : objectMapper.unreferenced(orphanCutoff, METADATA_BATCH)) {
            if (objects.deleteIfUnreferenced(id)) databaseObjects++;
        }
        int physicalOrphans = objects.deletePhysicalOrphans(orphanCutoff.toInstant(ZoneOffset.UTC));
        var result = new CleanupResult(metadata[0], metadata[1], databaseObjects, physicalOrphans);
        if (result.trashFiles() + result.revisions() + result.databaseObjects() + result.physicalOrphans() > 0) {
            LOG.info("Retention cleanup removed {} trash files, {} revisions, {} database objects and {} physical orphans",
                    result.trashFiles(), result.revisions(), result.databaseObjects(), result.physicalOrphans());
        }
        return result;
    }

    private void removeCompletedBatches(LocalDateTime cutoff) {
        for (var batch : retention.expiredBatches(cutoff, METADATA_BATCH)) {
            if (retention.pendingMembers(batch.rootId(), batch.rootDeletedVersion()) == 0) {
                retention.deleteBatch(batch.rootId(), batch.rootDeletedVersion());
            }
        }
    }

    @Scheduled(fixedDelayString = "${private-space.retention.cleanup-interval:PT6H}",
            initialDelayString = "${private-space.retention.cleanup-initial-delay:PT1M}")
    public void scheduledCleanup() {
        try { cleanup(); }
        catch (RuntimeException exception) { LOG.error("Retention cleanup failed; no success is reported and the next schedule will retry", exception); }
    }
}
