package com.privatespace;

import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Runs only the UI interaction checks on the shared real-server fixture. */
class MindmapUxIT {
    @TempDir Path directory;

    @Test
    void keepsPaginationDownAndEditsThroughCanvasControls() throws Exception {
        var fixture = new LearningMindmapIT();
        fixture.directory = directory;
        fixture.polishesMindmapInteractions();
    }
}
