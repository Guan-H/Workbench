package com.privatespace.modules.document.controller;

import java.util.Map;
import com.privatespace.modules.document.service.OfficeService;
import com.privatespace.modules.note.dto.NoteResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/documents/office")
public class OfficeController {
    private final OfficeService service;
    public OfficeController(OfficeService service) { this.service=service; }
    public record OpenRequest(@NotNull @Pattern(regexp="[0-9a-f-]{36}") String id, @NotNull @Pattern(regexp="[1-9][0-9]{0,18}") String baseVersion) {}
    public record ConvertRequest(@NotNull String id, @NotNull @Pattern(regexp="[1-9][0-9]{0,18}") String baseVersion, @NotNull String target) {}
    @PostMapping("/sessions")
    public Map<String,Object> open(@Valid @RequestBody OpenRequest request,@CookieValue("PRIVATE_SPACE_SESSION") String token) { return service.open(request.id(),request.baseVersion(),token); }
    @GetMapping("/sessions/{id}")
    public Map<String,Object> status(@PathVariable String id,@CookieValue("PRIVATE_SPACE_SESSION") String token) { return service.status(id,token); }
    @PostMapping("/sessions/{id}/save")
    public Map<String,Object> save(@PathVariable String id,@CookieValue("PRIVATE_SPACE_SESSION") String token) { return service.save(id,token); }
    @PostMapping("/convert")
    public NoteResponse convert(@Valid @RequestBody ConvertRequest request,@CookieValue("PRIVATE_SPACE_SESSION") String token,@RequestHeader("Idempotency-Key") String operation) {
        return service.convert(request.id(),request.baseVersion(),request.target(),operation,token);
    }
}
