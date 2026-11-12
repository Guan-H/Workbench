package com.privatespace;

import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import com.privatespace.modules.reader.service.NovelLibraryService;
import org.apache.ibatis.executor.Executor;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.plugin.Interceptor;
import org.apache.ibatis.plugin.Intercepts;
import org.apache.ibatis.plugin.Invocation;
import org.apache.ibatis.plugin.Signature;
import org.apache.ibatis.session.ResultHandler;
import org.apache.ibatis.session.RowBounds;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext;
import org.springframework.core.env.MapPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/** Real MySQL, file storage and Chrome checks, limited to navigation, reading and clipboard. */
class ReadingUxIT {
    @TempDir Path directory;

    @Test
    void loadsReferencedMetadataInOneQueryAndKeepsNavigationResponsive() throws Exception {
        String database = System.getenv("IT_DB_URL");
        if (database == null || !database.matches("jdbc:mysql://[^/]+/private_space_it(?:\\?.*)?")) {
            throw new IllegalStateException("ReadingUxIT requires an isolated private_space_it database");
        }
        int frontendPort;
        try (var socket = new ServerSocket(0)) { frontendPort = socket.getLocalPort(); }
        String setupToken = UUID.randomUUID().toString();
        var output = Path.of("../frontend/test-results/reading-ux-" + UUID.randomUUID()).toAbsolutePath().normalize();
        Files.createDirectories(output);
        var properties = new HashMap<String, Object>();
        properties.put("spring.datasource.url", database);
        properties.put("spring.datasource.username", System.getenv("IT_DB_USERNAME"));
        properties.put("spring.datasource.password", System.getenv("IT_DB_PASSWORD"));
        properties.put("private-space.storage.path", Files.createDirectories(directory.resolve("objects")).toString());
        properties.put("private-space.allowed-origins", "http://127.0.0.1:" + frontendPort);
        properties.put("private-space.setup-token", setupToken);
        properties.put("private-space.office.enabled", "false");
        properties.put("private-space.retention.enabled", "false");
        properties.put("private-space.vault-retention.enabled", "false");
        properties.put("server.port", "0");
        try (var context = new SpringApplicationBuilder(PrivateSpaceApplication.class).initializers(app ->
                app.getEnvironment().getPropertySources().addFirst(new MapPropertySource("reading-ux-it", properties))).run()) {
            int backendPort = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
            var command = new ProcessBuilder("node", "scripts/check-reading-ux.mjs").directory(Path.of("../frontend").toFile()).inheritIO();
            command.environment().put("READING_UX_BACKEND", "http://127.0.0.1:" + backendPort);
            command.environment().put("READING_UX_PORT", Integer.toString(frontendPort));
            command.environment().put("READING_UX_OUTPUT", output.toString());
            command.environment().put("READING_UX_SETUP", setupToken);
            command.environment().put("READING_UX_PASSWORD", UUID.randomUUID() + "!aB9");
            var process = command.start();
            if (!process.waitFor(180, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new IllegalStateException("Reading UI check timed out; artifacts: " + output);
            }
            assertThat(process.exitValue()).as("Chrome artifacts: %s", output).isZero();

            // Observe actual SQL without replacing its execution or results.
            var observer = new QueryObserver();
            context.getBean(SqlSessionFactory.class).getConfiguration().addInterceptor(observer);
            var library = context.getBean(NovelLibraryService.class).list();
            assertThat(library.books()).hasSize(32);
            assertThat(library.books().stream().filter(book -> book.file() != null)).hasSize(31);
            assertThat(library.books().stream().filter(book -> book.file() != null).allMatch(book -> book.file().content() == null)).isTrue();
            assertThat(observer.statements).hasSize(4);
            assertThat(observer.statements.stream().filter(id -> id.endsWith("NoteMapper.metadataBatch"))).hasSize(1);
            assertThat(observer.statements).noneMatch(id -> id.endsWith("NoteMapper.find"));
            System.out.println("PASS reading metadata: 32 references, 4 actual SQL queries, one batch, no source bodies; " + output);
        }
    }

    @Intercepts(@Signature(type = Executor.class, method = "query", args = {
            MappedStatement.class, Object.class, RowBounds.class, ResultHandler.class }))
    static class QueryObserver implements Interceptor {
        final List<String> statements = new ArrayList<>();
        public Object intercept(Invocation invocation) throws Throwable {
            statements.add(((MappedStatement) invocation.getArgs()[0]).getId());
            return invocation.proceed();
        }
    }
}
