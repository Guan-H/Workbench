package com.privatespace.modules.english.service.impl;

import java.net.URI;
import java.net.InetSocketAddress;
import java.net.ProxySelector;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import jakarta.annotation.PreDestroy;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.english.dto.ReadingDtos.*;
import com.privatespace.modules.english.mapper.ReadingSourceMapper;
import com.privatespace.modules.english.service.ReadingImportService;
import com.privatespace.modules.english.service.ReadingSourceService;
import com.privatespace.modules.english.util.ReadingHtml;
import com.privatespace.modules.english.util.ReadingResponseBody;
import com.privatespace.modules.english.util.ReadingRss;

@Service
public class ReadingSourceServiceImpl implements ReadingSourceService {
    private static final URI SOURCE = URI.create("https://www.nasa.gov/feed/");
    private final ReadingSourceMapper mapper;
    private final ReadingImportService importer;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean();
    private final HttpClient http;

    public ReadingSourceServiceImpl(ReadingSourceMapper mapper, ReadingImportService importer,
            @Value("${private-space.reading.proxy-url:}") String proxyUrl) {
        this.mapper = mapper; this.importer = importer;
        var builder = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8))
                .version(HttpClient.Version.HTTP_1_1).followRedirects(HttpClient.Redirect.NEVER);
        if (!proxyUrl.isBlank()) {
            URI proxy = URI.create(proxyUrl);
            if (!"http".equals(proxy.getScheme()) || proxy.getHost() == null || proxy.getPort() < 1 ||
                    proxy.getUserInfo() != null || proxy.getQuery() != null || proxy.getFragment() != null ||
                    !(proxy.getPath().isEmpty() || "/".equals(proxy.getPath()))) {
                throw new IllegalArgumentException("阅读来源代理须为无凭据的 HTTP 代理地址。");
            }
            builder.proxy(ProxySelector.of(new InetSocketAddress(proxy.getHost(), proxy.getPort())));
        }
        this.http = builder.build();
    }

    private String time(LocalDateTime value) { return value == null ? null : value.atOffset(ZoneOffset.UTC).toString(); }
    public SourceStatus status() {
        var state = mapper.state();
        boolean running = state.runningSince() != null && state.runningSince().isAfter(LocalDateTime.now(ZoneOffset.UTC).minusMinutes(2));
        return new SourceStatus("nasa", "NASA 原版科普", Long.toString(state.revision()), state.enabled(), running,
                time(state.lastAttemptAt()), time(state.lastSuccessAt()), state.lastAdded(), state.lastSkipped(), state.lastError(), time(state.retryAfterAt()));
    }
    public SourceStatus configure(Configure request) {
        long revision;
        try { revision = Long.parseLong(request.baseRevision()); }
        catch (NumberFormatException exception) { throw new ApiException(400, "INVALID_READING_SOURCE", "来源版本无效。"); }
        if (mapper.configure(revision, request.enabled()) != 1) {
            throw new ApiException(409, "READING_SOURCE_CHANGED", "来源设置已变化，请刷新后核对。");
        }
        return status();
    }

    /** A fixed source and a bounded single worker avoid arbitrary-URL fetches and blocking HTTP handlers. */
    public SourceStatus sync() {
        if (!busy.compareAndSet(false, true)) return status();
        try {
            if (mapper.begin() != 1) { busy.set(false); return status(); }
            worker.submit(this::pull);
        }
        catch (RuntimeException exception) {
            busy.set(false); mapper.failure(0, 0, "同步任务未能启动，请重试。"); throw exception;
        }
        return status();
    }

    @Scheduled(fixedDelay = 60000)
    public void scheduled() {
        var state = mapper.state();
        if (state.enabled() && (state.retryAfterAt() == null || !state.retryAfterAt().isAfter(LocalDateTime.now(ZoneOffset.UTC))) && (state.lastAttemptAt() == null ||
                state.lastAttemptAt().isBefore(LocalDateTime.now(ZoneOffset.UTC).minusHours(6)))) sync();
    }

    private void pull() {
        int added = 0, skipped = 0;
        try {
            var request = HttpRequest.newBuilder(SOURCE).timeout(Duration.ofSeconds(25))
                    .header("User-Agent", "WorkbenchReading/0.1 (https://github.com/Guan-H/Workbench)").GET().build();
            var response = http.send(request, info -> new ReadingResponseBody());
            if (response.statusCode() == 429 || response.statusCode() == 503) {
                mapper.rateLimited(retryTime(response.headers().firstValue("Retry-After").orElse("")));
                return;
            }
            if (response.statusCode() != 200) throw new IllegalStateException("HTTP " + response.statusCode());
            if (!response.headers().firstValue("Content-Type").orElse("").toLowerCase(java.util.Locale.ROOT).contains("xml")) {
                throw new IllegalStateException("响应格式不是 RSS XML");
            }
            var rows = ReadingRss.parse(response.body());
            for (var row : rows) {
                String title = ReadingHtml.text(row.title());
                String text = ReadingHtml.text(row.html());
                String url = row.url();
                URI link = URI.create(url);
                if (title.isBlank() || title.length() > 200 ||
                        text.length() < 100 || text.length() > 100000 || !"https".equals(link.getScheme()) ||
                        !("www.nasa.gov".equals(link.getHost()) || "science.nasa.gov".equals(link.getHost())) || link.getUserInfo() != null) { skipped++; continue; }
                if (text.matches("(?is).*(©|all rights reserved|used with permission|used by permission).*") ) { skipped++; continue; }
                if (importer.importNasa(row.key(), title, text, url, row.publishedAt())) added++; else skipped++;
            }
            mapper.success(added, skipped);
        } catch (Exception exception) {
            if (exception instanceof InterruptedException) Thread.currentThread().interrupt();
            // Only bounded operational information is recorded, never upstream response bodies.
            String message = exception instanceof IllegalStateException ? exception.getMessage()
                    : "同步失败（" + exception.getClass().getSimpleName() + "），请检查网络或稍后重试。";
            mapper.failure(added, skipped, message == null ? "同步失败，请重试。" : message.substring(0, Math.min(250, message.length())));
        } finally { busy.set(false); }
    }
    private LocalDateTime retryTime(String header) {
        var now = LocalDateTime.now(ZoneOffset.UTC);
        try { return now.plusSeconds(Math.max(60, Long.parseLong(header))); }
        catch (RuntimeException ignored) {
            try {
                var requested = java.time.ZonedDateTime.parse(header, java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME)
                        .withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime();
                return requested.isAfter(now.plusMinutes(1)) ? requested : now.plusMinutes(1);
            } catch (RuntimeException invalidDate) { return now.plusMinutes(15); }
        }
    }
    @PreDestroy public void close() { worker.shutdownNow(); }
}
