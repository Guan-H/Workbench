package com.privatespace.modules.home.dto;

import java.time.LocalDate;
import java.util.List;

/** All durations are integer minutes; one display day is always 480 minutes. */
public final class CalendarLedgerDtos {
    private CalendarLedgerDtos() {}
    public record Totals(long overtimeMinutes, long timeOffMinutes) {}
    public record Opening(long version, LocalDate startDate, Long openingMinutes) {}
    public record Month(String month, long overtimeMinutes, long timeOffMinutes) {}
    public record Summary(String month, Totals monthly, Totals cumulative, Opening opening,
                          String recordsRevision, long netMinutes) {}
    public record History(List<Month> items, long total, int page) {}
    public record Change(String baseVersion, String recordsRevision, String startDate, Long openingMinutes) {}
    public record Projection(Change request, long overtimeMinutes, long timeOffMinutes, long netMinutes) {}
}
