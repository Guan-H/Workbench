package com.privatespace.modules.settings.controller;

import com.privatespace.modules.settings.dto.AppearanceDtos.*;
import com.privatespace.modules.settings.service.AppearanceService;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/settings/appearance")
public class AppearanceController {
    private final AppearanceService service;
    public AppearanceController(AppearanceService service) { this.service=service; }
    @GetMapping public Saved read() { return service.read(); }
    @GetMapping("/images") public java.util.List<String> images() { return service.listImages(); }
    @PutMapping public Saved save(@RequestBody Write request) { return service.save(request); }
    @PostMapping("/images") public Image upload(@RequestParam("file") MultipartFile file) { return service.upload(file); }
    @GetMapping("/images/{id}")
    public ResponseEntity<byte[]> image(@PathVariable String id) {
        return ResponseEntity.ok().contentType(MediaType.IMAGE_JPEG)
                .header("Cache-Control","private, max-age=86400")
                .header("X-Content-Type-Options","nosniff").body(service.image(id));
    }
}
