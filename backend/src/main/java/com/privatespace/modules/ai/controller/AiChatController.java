package com.privatespace.modules.ai.controller;

import com.privatespace.modules.ai.dto.AiChat.Conversation;
import com.privatespace.modules.ai.dto.AiChat.Detail;
import com.privatespace.modules.ai.dto.AiChat.Regenerate;
import com.privatespace.modules.ai.dto.AiChat.Pin;
import com.privatespace.modules.ai.dto.AiChat.Rename;
import com.privatespace.modules.ai.dto.AiChat.SelectAnswer;
import com.privatespace.modules.ai.dto.AiChat.Send;
import com.privatespace.modules.ai.dto.AiChat.Turn;
import com.privatespace.modules.ai.service.AiChatService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import jakarta.servlet.http.HttpServletResponse;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/api/v1/ai/conversations")
public class AiChatController {
    private final AiChatService service;
    private final ObjectMapper json;

    public AiChatController(AiChatService service, ObjectMapper json) {
        this.service = service;
        this.json = json;
    }

    @GetMapping
    public List<Conversation> list(@RequestParam(defaultValue = "1") int page,
                                   @RequestParam(defaultValue = "") String query) {
        return service.list(page, query);
    }

    @PostMapping
    public Conversation create() {
        return service.create();
    }

    @PutMapping("/{id}/title")
    public Conversation rename(@PathVariable String id, @RequestBody Rename request) {
        return service.rename(id, request);
    }

    @PutMapping("/{id}/pin")
    public Conversation pin(@PathVariable String id, @RequestBody Pin request) {
        return service.pin(id, request);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id, @RequestParam int revision) {
        service.delete(id, revision);
    }

    @GetMapping("/{id}")
    public Detail detail(@PathVariable String id) {
        return service.detail(id);
    }

    @PostMapping("/{id}/turns")
    public Turn send(@PathVariable String id, @RequestBody Send request) {
        return service.send(id, request);
    }

    @PostMapping("/{id}/turns/{turnId}/regenerate")
    public Turn regenerate(@PathVariable String id, @PathVariable String turnId, @RequestBody Regenerate request) {
        return service.regenerate(id, turnId, request);
    }

    @PutMapping("/{id}/turns/{turnId}/selected-answer/{answerId}")
    public Detail select(@PathVariable String id, @PathVariable String turnId, @PathVariable String answerId,
                         @RequestBody SelectAnswer request) {
        return service.selectAnswer(id, turnId, answerId, request.revision());
    }

    @GetMapping({"/{id}/answers/{answerId}", "/{id}/turns/{answerId}"})
    public Turn answer(@PathVariable String id, @PathVariable String answerId) {
        return service.answer(id, answerId);
    }

    @GetMapping(value = {"/{id}/answers/{answerId}/events", "/{id}/turns/{answerId}/events"}, produces = "text/event-stream")
    public void events(@PathVariable String id, @PathVariable String answerId, HttpServletResponse response) throws IOException {
        service.stream(id, answerId, new AiChatService.StreamSink() {
            public void snapshot(Turn turn) throws IOException { event(response, "snapshot", turn); }
            public void delta(int offset, String text) throws IOException {
                event(response, "delta", Map.of("offset", offset, "text", text));
            }
            public void heartbeat() throws IOException {
                response.getOutputStream().write(": heartbeat\n\n".getBytes(StandardCharsets.UTF_8));
                response.flushBuffer();
            }
            public void deleted() throws IOException {
                event(response, "deleted", Map.of());
            }
        });
    }

    private void event(HttpServletResponse response, String event, Object value) throws IOException {
        response.setContentType("text/event-stream");
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control", "no-cache, no-store, no-transform");
        response.setHeader("X-Accel-Buffering", "no");
        String frame = "event: " + event + "\ndata: " + json.writeValueAsString(value) + "\n\n";
        response.getOutputStream().write(frame.getBytes(StandardCharsets.UTF_8));
        response.flushBuffer();
    }

    @PostMapping({"/{id}/answers/{answerId}/stop", "/{id}/turns/{answerId}/stop"})
    public Turn stop(@PathVariable String id, @PathVariable String answerId) {
        return service.stop(id, answerId);
    }
}
