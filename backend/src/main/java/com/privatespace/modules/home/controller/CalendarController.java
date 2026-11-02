package com.privatespace.modules.home.controller;

import com.privatespace.modules.home.dto.CalendarResponse;
import com.privatespace.modules.home.service.CalendarService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/home/calendar")
public class CalendarController {
    private final CalendarService service;

    public CalendarController(CalendarService service) {
        this.service = service;
    }

    @GetMapping
    public CalendarResponse calendar(@RequestParam(required = false) String month) {
        return service.calendar(month);
    }
}
