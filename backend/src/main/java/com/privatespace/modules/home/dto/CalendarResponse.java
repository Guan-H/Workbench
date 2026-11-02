package com.privatespace.modules.home.dto;

import java.time.LocalDate;
import java.util.List;

/** Mainland China calendar with traceable official schedules; missing years are never inferred. */
public record CalendarResponse(String month, LocalDate today, String timeZone, boolean available,
        Source source, List<Day> days, Countdown nextHoliday, String notice) {
    public record Source(String title, String url, LocalDate checkedOn) {}
    public record Day(LocalDate date, int day, int weekday, String kind, String holiday) {}
    public record Holiday(String name, LocalDate start, LocalDate end) {}
    public record Countdown(String name, LocalDate start, LocalDate end, long daysUntil) {}
    public record Schedule(int year, Source source, List<Holiday> holidays, List<LocalDate> makeupDays) {}
}
