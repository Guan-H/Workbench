package com.privatespace.modules.home.controller;

import com.privatespace.modules.home.dto.CalendarLedgerDtos.*;
import com.privatespace.modules.home.service.CalendarLedgerService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/home/calendar/ledger")
public class CalendarLedgerController {
    private final CalendarLedgerService service;
    public CalendarLedgerController(CalendarLedgerService service) { this.service=service; }
    @GetMapping public Summary summary(@RequestParam String month) { return service.summary(month); }
    @GetMapping("/history") public History history(@RequestParam(defaultValue="1") int page) { return service.history(page); }
    @PostMapping("/opening-preview") public Projection preview(@RequestBody Change request) { return service.preview(request); }
    @PutMapping("/opening") public Opening save(@RequestBody Change request,@RequestHeader("Idempotency-Key") String operation) { return service.save(request,operation); }
}
