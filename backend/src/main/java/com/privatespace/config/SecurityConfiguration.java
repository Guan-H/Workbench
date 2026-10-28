package com.privatespace.config;

import java.util.Arrays;
import java.util.List;
import java.util.Set;

import com.privatespace.common.exception.ApiProblem;
import com.privatespace.modules.auth.service.AuthService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import com.privatespace.modules.sync.service.SyncDeviceService;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;

@Configuration(proxyBeanMethods = false)
public class SecurityConfiguration {
    public static final String SESSION_COOKIE = "PRIVATE_SPACE_SESSION";

    @Bean
    PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(12); }

    @Bean
    CookieCsrfTokenRepository csrfRepository(@Value("${private-space.secure-cookie:false}") boolean secure) {
        var repository = new CookieCsrfTokenRepository();
        repository.setHeaderName("X-CSRF-TOKEN");
        repository.setCookieCustomizer(cookie -> cookie.httpOnly(true).secure(secure).sameSite("Strict").path("/"));
        return repository;
    }

    @Bean
    @Order(0)
    SecurityFilterChain syncSecurity(HttpSecurity http, SyncDeviceService devices, ObjectMapper json) throws Exception {
        http.securityMatcher("/api/v1/sync/**")
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .csrf(csrf -> csrf.disable()).requestCache(cache -> cache.disable())
                .formLogin(form -> form.disable()).httpBasic(basic -> basic.disable()).logout(logout -> logout.disable())
                .authorizeHttpRequests(request -> request.requestMatchers(org.springframework.http.HttpMethod.POST, "/api/v1/sync/pair").permitAll().anyRequest().hasRole("SYNC"))
                .exceptionHandling(errors -> errors.authenticationEntryPoint((request, response, exception) -> problem(response, json, 401, "DEVICE_UNAUTHORIZED", "设备未授权或已被撤销。")))
                .addFilterBefore(new OncePerRequestFilter() {
                    @Override
                    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                            throws ServletException, IOException {
                        String header = request.getHeader("Authorization");
                        String id = header != null && header.startsWith("Bearer ") ? devices.authenticate(header.substring(7)) : null;
                        if (id != null) SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                                id, null, List.of(new SimpleGrantedAuthority("ROLE_SYNC"))));
                        chain.doFilter(request, response);
                    }
                }, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    @Bean
    @Order(1)
    SecurityFilterChain webSecurity(HttpSecurity http, AuthService auth, ObjectMapper json,
            CookieCsrfTokenRepository csrfRepository,
            @Value("${private-space.allowed-origins:http://127.0.0.1:5173,http://localhost:5173}") String origins) throws Exception {
        Set<String> allowed = Set.copyOf(Arrays.asList(origins.split(",")));
        http.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .csrf(csrf -> csrf.csrfTokenRepository(csrfRepository).csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler()))
                .requestCache(cache -> cache.disable()).formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable()).logout(logout -> logout.disable())
                .authorizeHttpRequests(request -> request
                        .requestMatchers("/api/system/health/**", "/api/system/health",
                                "/api/v1/auth/status", "/api/v1/auth/csrf", "/api/v1/auth/login", "/api/v1/auth/initialize").permitAll()
                        .anyRequest().hasRole("WEB"))
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((request, response, exception) -> problem(response, json, 401, "UNAUTHENTICATED", "请先登录。"))
                        .accessDeniedHandler((request, response, exception) -> problem(response, json, 403, "FORBIDDEN", "请求未通过安全校验，请刷新页面后重试。")))
                .addFilterBefore(new OncePerRequestFilter() {
                    @Override
                    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                            throws ServletException, IOException {
                        if (request.getCookies() != null) {
                            for (Cookie cookie : request.getCookies()) {
                                if (SESSION_COOKIE.equals(cookie.getName()) && auth.valid(cookie.getValue())) {
                                    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                                            auth.username(), null, List.of(new SimpleGrantedAuthority("ROLE_WEB"))));
                                }
                            }
                        }
                        chain.doFilter(request, response);
                    }
                }, UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(new OncePerRequestFilter() {
                    @Override
                    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                            throws ServletException, IOException {
                        if (Set.of("POST", "PUT", "PATCH", "DELETE").contains(request.getMethod())
                                && !allowed.contains(request.getHeader("Origin"))) {
                            problem(response, json, 403, "FORBIDDEN", "请求来源未获允许。");
                            return;
                        }
                        chain.doFilter(request, response);
                    }
                }, CsrfFilter.class);
        return http.build();
    }

    private static void problem(HttpServletResponse response, ObjectMapper json, int status, String code, String title) throws IOException {
        response.setStatus(status);
        response.setContentType("application/problem+json");
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write(json.writeValueAsString(ApiProblem.of(status, code, title)));
    }
}
