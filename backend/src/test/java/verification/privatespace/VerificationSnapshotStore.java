package verification.privatespace;

import java.util.Optional;
import java.util.UUID;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

/** Real transactional MySQL prototype for M0, compiled into tests only. */
public class VerificationSnapshotStore {

    public record Snapshot(String version, String envelope) {
    }

    private final JdbcTemplate jdbc;

    public VerificationSnapshotStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Snapshot> read(UUID id) {
        return jdbc.query("SELECT version, envelope FROM verification_vault WHERE vault_id = ?",
                (row, index) -> new Snapshot(Long.toString(row.getLong(1)), row.getString(2)), id.toString())
                .stream().findFirst();
    }

    /** Snapshot and history publish in one transaction; stale updates never retry unconditionally. */
    @Transactional
    public Optional<Snapshot> save(UUID id, long baseVersion, String envelope) {
        long next = Math.addExact(baseVersion, 1);
        if (baseVersion == 0) {
            try {
                jdbc.update("INSERT INTO verification_vault (vault_id, version, envelope) VALUES (?, 1, ?)",
                        id.toString(), envelope);
            } catch (DuplicateKeyException exception) {
                return Optional.empty();
            }
        } else if (jdbc.update("UPDATE verification_vault SET version = ?, envelope = ? WHERE vault_id = ? AND version = ?",
                next, envelope, id.toString(), baseVersion) == 0) {
            return Optional.empty();
        }
        jdbc.update("INSERT INTO verification_vault_history (vault_id, version, envelope) VALUES (?, ?, ?)",
                id.toString(), next, envelope);
        return Optional.of(new Snapshot(Long.toString(next), envelope));
    }
}
