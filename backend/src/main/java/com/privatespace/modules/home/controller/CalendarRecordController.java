package com.privatespace.modules.home.controller;

import com.privatespace.modules.home.dto.CalendarRecordDtos.*;
import com.privatespace.modules.home.service.CalendarRecordService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/home/calendar/records")
public class CalendarRecordController {
    private final CalendarRecordService service;
    public CalendarRecordController(CalendarRecordService service) { this.service = service; }
    @GetMapping public Page list(@RequestParam String month, @RequestParam(required = false) String date, @RequestParam(defaultValue = "1") int page) { return service.list(month, date, page); }
    @PutMapping("/{id}") public Item save(@PathVariable String id, @RequestBody Write request, @RequestHeader("Idempotency-Key") String operation) { return service.save(id, request, operation); }
    @PostMapping("/{id}/delete") public Item delete(@PathVariable String id, @RequestBody Version request, @RequestHeader("Idempotency-Key") String operation) { return service.delete(id, request, operation); }
}
