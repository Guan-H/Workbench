package verification.privatespace;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Authenticated test transport only. Absent from the shipped JAR and the normal application. */
@RestController
@RequestMapping("/api/verification/vault/{id}")
public class VerificationSnapshotController {

    public record SaveRequest(String baseVersion, String envelope) {
    }

    private final VerificationSnapshotStore store;
    private final byte[] token;

    public VerificationSnapshotController(VerificationSnapshotStore store, String token) {
        this.store = store;
        this.token = token.getBytes(StandardCharsets.UTF_8);
    }

    @GetMapping
    public VerificationSnapshotStore.Snapshot read(@PathVariable UUID id,
            @RequestHeader(value = "X-Verification-Token", defaultValue = "") String credential) {
        authorize(credential);
        return store.read(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    @PutMapping
    public VerificationSnapshotStore.Snapshot save(@PathVariable UUID id,
            @RequestHeader(value = "X-Verification-Token", defaultValue = "") String credential,
            @RequestBody SaveRequest request) {
        authorize(credential);
        if (request.envelope() == null || request.envelope().length() > 2 * 1024 * 1024
                || request.baseVersion() == null || !request.baseVersion().matches("[0-9]{1,9}")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        }
        // This test transport stores opaque ASCII envelopes. It does not implement product import validation.
        if (!StandardCharsets.US_ASCII.newEncoder().canEncode(request.envelope())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        }
        return store.save(id, Long.parseLong(request.baseVersion()), request.envelope())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT));
    }

    private void authorize(String credential) {
        if (!MessageDigest.isEqual(token, credential.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
    }
}
