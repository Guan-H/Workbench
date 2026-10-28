package verification.privatespace;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import com.privatespace.PrivateSpaceApplication;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Browser encryption -> real HTTP -> transactional MySQL, including a full Spring-context restart. */
class VaultCryptoIT {

    @TempDir
    Path directory;

    private final String token = UUID.randomUUID().toString();
    private final String id = UUID.randomUUID().toString();

    @Test
    void verifiesBrowserEncryptionPersistenceConcurrencyAndOfflineRecovery() throws Exception {
        try (var context = start()) {
            var jdbc = context.getBean(JdbcTemplate.class);
            new ResourceDatabasePopulator(new ClassPathResource("verification/vault.sql"))
                    .execute(context.getBean(javax.sql.DataSource.class));
            runBrowser(context, "write");
            assertNoPlaintext(jdbc);
            assertRollback(context);
        }
        // A new Spring server/pool reads the existing database. No in-memory snapshot survives the close.
        try (var context = start()) {
            runBrowser(context, "restore");
            assertNoPlaintext(context.getBean(JdbcTemplate.class));
        }
    }

    private ConfigurableApplicationContext start() throws Exception {
        String url = System.getenv("IT_DB_URL");
        if (url == null || !url.matches("jdbc:mysql://[^/]+/private_space_it(?:\\?.*)?")) {
            throw new IllegalStateException("Crypto verification requires private_space_it");
        }
        Path storage = Files.createDirectories(directory.resolve("objects"));
        Map<String, Object> properties = Map.of(
                "spring.datasource.url", url,
                "spring.datasource.username", System.getenv("IT_DB_USERNAME"),
                "spring.datasource.password", System.getenv("IT_DB_PASSWORD"),
                "private-space.storage.path", storage.toString(),
                "management.health.diskspace.path", storage.toString(),
                "server.port", "0",
                "verification.token", token);
        return new SpringApplicationBuilder(PrivateSpaceApplication.class, TransportConfiguration.class)
                .initializers(context -> context.getEnvironment().getPropertySources()
                        .addFirst(new MapPropertySource("m0-verification", properties)))
                .run();
    }

    private void runBrowser(ConfigurableApplicationContext context, String phase) throws Exception {
        int port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
        Path frontend = Path.of("../frontend").toAbsolutePath().normalize();
        Path log = directory.resolve(phase + ".log");
        ProcessBuilder builder = new ProcessBuilder("node", "scripts/check-vault-crypto.mjs", phase)
                .directory(frontend.toFile()).redirectErrorStream(true).redirectOutput(log.toFile());
        builder.environment().put("VERIFICATION_BACKEND", "http://127.0.0.1:" + port);
        builder.environment().put("VERIFICATION_TOKEN", token);
        builder.environment().put("VERIFICATION_VAULT_ID", id);
        Process process = builder.start();
        boolean finished = process.waitFor(Duration.ofMinutes(3).toSeconds(), TimeUnit.SECONDS);
        if (!finished) process.destroyForcibly();
        String output = Files.readString(log);
        assertThat(finished).as("Browser verification timeout").isTrue();
        assertThat(output).doesNotContain("M0_TEST_SECRET", "M0_FAKE_MASTER", "M0_FAKE_BACKUP");
        assertThat(process.exitValue()).as(output).isZero();
        assertThat(output).contains("PASS: vault-crypto-" + phase);
    }

    private void assertNoPlaintext(JdbcTemplate jdbc) {
        for (String table : new String[] {"verification_vault", "verification_vault_history"}) {
            for (String envelope : jdbc.queryForList("SELECT envelope FROM " + table, String.class)) {
                assertThat(envelope).doesNotContain("M0_TEST_SECRET", "M0_FAKE_MASTER", "M0_FAKE_BACKUP", "example.invalid", "虚构账号");
            }
        }
        assertThat(jdbc.queryForObject("SELECT version FROM verification_vault WHERE vault_id = ?",
                Long.class, id)).isEqualTo(3L);
    }

    private void assertRollback(ConfigurableApplicationContext context) {
        var store = context.getBean(VerificationSnapshotStore.class);
        var jdbc = context.getBean(JdbcTemplate.class);
        UUID rollbackId = UUID.randomUUID();
        store.save(rollbackId, 0, "ciphertext-before");
        jdbc.update("INSERT INTO verification_vault_history VALUES (?, 2, ?)", rollbackId.toString(), "injected-history-collision");
        assertThatThrownBy(() -> store.save(rollbackId, 1, "ciphertext-after"))
                .isInstanceOf(org.springframework.dao.DuplicateKeyException.class);
        assertThat(store.read(rollbackId).orElseThrow())
                .isEqualTo(new VerificationSnapshotStore.Snapshot("1", "ciphertext-before"));
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TransportConfiguration {
        @Bean
        @org.springframework.core.annotation.Order(0)
        org.springframework.security.web.SecurityFilterChain verificationSecurity(
                org.springframework.security.config.annotation.web.builders.HttpSecurity http) throws Exception {
            return http.securityMatcher("/api/verification/**").csrf(csrf -> csrf.disable())
                    .authorizeHttpRequests(requests -> requests.anyRequest().permitAll()).build();
        }

        @Bean
        VerificationSnapshotStore verificationStore(JdbcTemplate jdbc) {
            return new VerificationSnapshotStore(jdbc);
        }

        @Bean
        VerificationSnapshotController verificationController(VerificationSnapshotStore store,
                org.springframework.core.env.Environment environment) {
            return new VerificationSnapshotController(store, environment.getRequiredProperty("verification.token"));
        }
    }
}
