package com.privatespace.modules.english.controller;

import com.privatespace.modules.english.dto.EnglishDtos.*;
import com.privatespace.modules.english.service.EnglishService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/home/english")
public class EnglishController {
    private final EnglishService service;
    public EnglishController(EnglishService service){this.service=service;}
    @GetMapping public ResponseEntity<Daily> daily(@RequestParam(required=false) String date,@RequestParam(defaultValue="1") int page,@RequestParam(required=false) Long batch){return ResponseEntity.ok().header("Cache-Control","no-store").body(service.daily(date,page,batch));}
    @GetMapping("/webhook") public ResponseEntity<Status> status(){return ResponseEntity.ok().header("Cache-Control","no-store").body(service.status());}
    @PostMapping("/webhook") public ResponseEntity<Credential> change(@RequestBody Change change){return ResponseEntity.ok().header("Cache-Control","no-store").body(service.change(change));}
    @GetMapping("/webhook/logs") public ResponseEntity<Logs> logs(@RequestParam(defaultValue="1") int page){return ResponseEntity.ok().header("Cache-Control","no-store").body(service.logs(page));}
}
