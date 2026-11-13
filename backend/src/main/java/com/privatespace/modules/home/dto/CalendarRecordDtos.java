package com.privatespace.modules.home.dto;

import java.util.List;
import java.math.BigDecimal;

/** Calendar times are minute-precision local times in Asia/Shanghai. */
public final class CalendarRecordDtos {
    private CalendarRecordDtos() {}
    public record Write(String baseVersion, String kind, String date, String title, String notes,
                        String time, boolean completed, String start, String end, BigDecimal overtimeMinutes) {}
    public record Version(String baseVersion) {}
    public record Item(String id, String version, String kind, String date, String title, String notes,
                       String time, boolean completed, String start, String end, int overtimeMinutes, boolean deleted) {}
    public record Preview(String kind, String title, String time, boolean completed,
                          String start, String end, int overtimeMinutes) {}
    public record DaySummary(String date, long todos, long pending, long others, long overtimes, long overtimeMinutes) {}
    public record Day(String date, long todos, long pending, long others, long overtimes, long overtimeMinutes, List<Preview> previews) {}
    public record Page(String month, List<Day> days, long overtimeMinutes, List<Item> items, long total, int page) {}
}
