package com.privatespace.modules.auth.service;

import com.privatespace.modules.auth.dto.CredentialsRequest;

public interface AuthService {
    boolean initialized();
    String username();
    void initialize(CredentialsRequest request);
    String login(CredentialsRequest request, String remoteAddress);
    boolean valid(String token);
    void logout(String token);
}
