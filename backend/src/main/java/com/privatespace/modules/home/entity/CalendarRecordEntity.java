package com.privatespace.modules.home.entity;

import java.time.LocalDate;
import java.time.LocalDateTime;

public record CalendarRecordEntity(String id, String kind, LocalDate eventDate, String title, String notes,
                                   String taskTime, boolean completed, LocalDateTime startedAt, LocalDateTime endedAt,
                                   int breakMinutes, int overtimeMinutes, long version, boolean deleted) {}
