package com.privatespace.modules.ai.controller;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.ai.dto.AiRequests.Probe;
import com.privatespace.modules.ai.dto.AiRequests.Model;
import com.privatespace.modules.ai.dto.AiRequests.Result;
import com.privatespace.modules.ai.dto.AiRequests.Save;
import com.privatespace.modules.ai.dto.AiRequests.Settings;
import com.privatespace.modules.ai.service.AiService;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.List;

@RestController
@RequestMapping("/api/v1/ai")
public class AiController {
    private final AiService service;
    private final ObjectMapper json;

    public AiController(AiService service, ObjectMapper json) {
        this.service = service;
        this.json = json;
    }

    @GetMapping("/providers")
    public List<Settings> providers() {
        return service.providers();
    }

    @GetMapping("/settings")
    public Settings settings(@RequestParam(defaultValue = "deepseek") String provider) {
        return service.settings(provider);
    }

    @PutMapping("/settings")
    public Settings save(@RequestParam(defaultValue = "deepseek") String provider, @RequestBody Save request) {
        return service.save(provider, request);
    }

    @GetMapping("/models")
    public List<Model> discoverModels(@RequestParam(defaultValue = "deepseek") String provider) {
        return service.discoverModels(provider);
    }

    @PostMapping("/probe")
    public Result probe(@RequestBody Probe request) throws IOException {
        return service.probe(request, null);
    }

    @PostMapping("/probe/stream")
    public void stream(@RequestBody Probe request, HttpServletResponse response) throws IOException {
        try {
            Result result = service.probe(request, chunk -> send(response, "delta", Map.of("text", chunk)));
            send(response, "done", result);
        } catch (ApiException failure) {
            if (!response.isCommitted()) throw failure;
            send(response, "error", Map.of("message", failure.getMessage()));
        }
    }

    private void send(HttpServletResponse response, String event, Object value) throws IOException {
        if (!response.isCommitted()) {
            response.setContentType("text/event-stream");
            response.setCharacterEncoding("UTF-8");
            response.setHeader("Cache-Control", "no-store");
        }
        String frame = "event: " + event + "\ndata: " + json.writeValueAsString(value) + "\n\n";
        response.getOutputStream().write(frame.getBytes(StandardCharsets.UTF_8));
        response.flushBuffer();
    }
}
