package com.privatespace.common.health;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.SecureRandom;

import com.privatespace.config.StorageProperties;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;

/** Probes actual private-volume IO so readiness cannot report success on a read-only volume. */
@Component("privateStorageHealthIndicator")
public class PrivateStorageHealthIndicator implements HealthIndicator {

    private final Path root;
    private final SecureRandom random = new SecureRandom();

    public PrivateStorageHealthIndicator(StorageProperties properties) throws IOException {
        this.root = properties.path().toAbsolutePath().normalize();
        Files.createDirectories(root);
    }

    @Override
    public Health health() {
        Path probe = null;
        Health result = Health.down().build();
        try {
            byte[] expected = new byte[32];
            random.nextBytes(expected);
            // Never touch user objects: each probe owns only a newly created temporary file.
            probe = Files.createTempFile(root, ".health-", ".tmp");
            try (FileChannel channel = FileChannel.open(probe, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(expected);
                while (buffer.hasRemaining()) {
                    channel.write(buffer);
                }
                channel.force(true);
            }
            result = MessageDigest.isEqual(expected, Files.readAllBytes(probe))
                    ? Health.up().build() : Health.down().build();
        } catch (IOException | SecurityException exception) {
            // Public health responses intentionally omit paths and exception details.
            result = Health.down().build();
        }
        if (probe != null) {
            try {
                Files.deleteIfExists(probe);
            } catch (IOException | SecurityException exception) {
                result = Health.down().build();
            }
        }
        return result;
    }
}
