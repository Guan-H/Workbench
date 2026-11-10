package com.privatespace.modules.english.controller;
import java.io.IOException;
import com.privatespace.modules.english.dto.EnglishDtos.Receipt;
import com.privatespace.modules.english.service.EnglishService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/hooks/english")
public class EnglishReceiverController {
    private final EnglishService service;
    public EnglishReceiverController(EnglishService service){this.service=service;}
    @PostMapping(consumes="application/json") public ResponseEntity<Receipt> receive(HttpServletRequest request) throws IOException {
        byte[] body=request.getInputStream().readNBytes(1024*1024+1);
        return ResponseEntity.ok().header("Cache-Control","no-store").body(service.receive(request.getHeader("Authorization").substring(7),body));
    }
}
