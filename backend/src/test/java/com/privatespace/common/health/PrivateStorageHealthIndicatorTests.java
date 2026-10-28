package com.privatespace.common.health;

import java.nio.file.Files;
import java.nio.file.Path;

import com.privatespace.config.StorageProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.health.contributor.Status;

import static org.assertj.core.api.Assertions.assertThat;

class PrivateStorageHealthIndicatorTests {

    @TempDir
    Path directory;

    @Test
    void probesRealVolumeWithoutChangingExistingFiles() throws Exception {
        Path content = directory.resolve("笔记.md");
        Files.writeString(content, "# Existing content");
        var indicator = new PrivateStorageHealthIndicator(new StorageProperties(directory));

        assertThat(indicator.health().getStatus()).isEqualTo(Status.UP);
        assertThat(Files.readString(content)).isEqualTo("# Existing content");
        try (var files = Files.list(directory)) {
            assertThat(files.toList()).containsExactly(content);
        }
    }

    @Test
    void reportsDownWhenConfiguredDirectoryBecomesUnavailable() throws Exception {
        Path volume = directory.resolve("volume");
        var indicator = new PrivateStorageHealthIndicator(new StorageProperties(volume));
        Files.delete(volume);
        Files.writeString(volume, "a file now occupies the directory path");

        assertThat(indicator.health().getStatus()).isEqualTo(Status.DOWN);
        assertThat(indicator.health().getDetails()).isEmpty();
    }
}
