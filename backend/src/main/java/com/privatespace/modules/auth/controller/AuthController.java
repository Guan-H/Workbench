package com.privatespace.modules.auth.controller;

import java.time.Duration;
import java.util.Map;

import com.privatespace.config.SecurityConfiguration;
import com.privatespace.modules.auth.dto.AuthStatusResponse;
import com.privatespace.modules.auth.dto.CredentialsRequest;
import com.privatespace.modules.auth.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.Authentication;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private final AuthService service;
    private final CookieCsrfTokenRepository csrf;
    private final boolean secure;

    public AuthController(AuthService service, CookieCsrfTokenRepository csrf,
            @Value("${private-space.secure-cookie:false}") boolean secure) {
        this.service = service;
        this.csrf = csrf;
        this.secure = secure;
    }

    @GetMapping("/status")
    public AuthStatusResponse status(Authentication authentication) {
        boolean authenticated = authentication != null && !(authentication instanceof AnonymousAuthenticationToken);
        return new AuthStatusResponse(service.initialized(), authenticated, authenticated ? authentication.getName() : null);
    }

    @GetMapping("/csrf")
    public Map<String, String> csrf(CsrfToken token) { return Map.of("token", token.getToken()); }

    @PostMapping("/initialize")
    public AuthStatusResponse initialize(@Valid @RequestBody CredentialsRequest credentials,
            HttpServletRequest request, HttpServletResponse response) {
        service.initialize(credentials);
        return login(credentials, request, response);
    }

    @PostMapping("/login")
    public AuthStatusResponse login(@Valid @RequestBody CredentialsRequest credentials,
            HttpServletRequest request, HttpServletResponse response) {
        String session = service.login(credentials, request.getRemoteAddr());
        cookie(response, session, Duration.ofHours(12));
        csrf.saveToken(null, request, response);
        return new AuthStatusResponse(true, true, credentials.username().strip());
    }

    @PostMapping("/logout")
    public Map<String, Boolean> logout(HttpServletRequest request, HttpServletResponse response) {
        if (request.getCookies() != null) {
            for (var cookie : request.getCookies()) {
                if (SecurityConfiguration.SESSION_COOKIE.equals(cookie.getName())) service.logout(cookie.getValue());
            }
        }
        cookie(response, "", Duration.ZERO);
        csrf.saveToken(null, request, response);
        return Map.of("loggedOut", true);
    }

    private void cookie(HttpServletResponse response, String token, Duration duration) {
        response.addHeader("Set-Cookie", ResponseCookie.from(SecurityConfiguration.SESSION_COOKIE, token)
                .httpOnly(true).secure(secure).sameSite("Strict").path("/").maxAge(duration).build().toString());
    }
}
