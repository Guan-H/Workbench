package com.privatespace.modules.home.service;

import com.privatespace.modules.home.dto.CalendarResponse;

public interface CalendarService {
    CalendarResponse calendar(String month);
}
