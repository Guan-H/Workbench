package com.privatespace.modules.home.service;

import com.privatespace.modules.home.dto.CalendarLedgerDtos.*;

public interface CalendarLedgerService {
    Summary summary(String month);
    History history(int page);
    Projection preview(Change request);
    Opening save(Change request, String operation);
}
