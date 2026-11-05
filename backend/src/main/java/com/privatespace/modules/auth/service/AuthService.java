package com.privatespace.modules.auth.service;

import com.privatespace.modules.auth.dto.CredentialsRequest;
import com.privatespace.modules.auth.dto.WebSessionResponse;
import java.util.List;

public interface AuthService {
    boolean initialized();
    String username();
    void initialize(CredentialsRequest request);
    String login(CredentialsRequest request, String remoteAddress);
    boolean valid(String token);
    void logout(String token);
    List<WebSessionResponse> sessions(String currentToken);
    /** Repeated revocation is harmless; the caller's own session uses the normal logout flow. */
    int revokeSession(String currentToken, String sessionId);
}
