package com.privatespace.modules.home.service;

import com.privatespace.modules.home.dto.CalendarRecordDtos.*;

public interface CalendarRecordService {
    Page list(String month, String date, int page);
    Item save(String id, Write request, String operation);
    Item delete(String id, Version request, String operation);
}
