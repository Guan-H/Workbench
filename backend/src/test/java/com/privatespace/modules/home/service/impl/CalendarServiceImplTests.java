package com.privatespace.modules.home.service.impl;

import java.time.LocalDate;
import java.time.YearMonth;

import com.privatespace.common.exception.ApiException;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.*;

class CalendarServiceImplTests {
    private CalendarServiceImpl service() throws Exception {
        return new CalendarServiceImpl(JsonMapper.builder().build());
    }

    @Test
    void officialScheduleHasThirtyThreeHolidayDaysAndSixMakeupDays() throws Exception {
        var calendar = service();
        long holidays = 0;
        long makeup = 0;
        for (int month = 1; month <= 12; month++) {
            var result = calendar.build(YearMonth.of(2026, month), LocalDate.of(2026, 1, 1));
            assertTrue(result.available());
            assertNotNull(result.source());
            holidays += result.days().stream().filter(day -> day.kind().equals("holiday")).count();
            makeup += result.days().stream().filter(day -> day.kind().equals("makeup")).count();
        }
        assertEquals(33, holidays);
        assertEquals(6, makeup);
        var january = calendar.build(YearMonth.of(2026, 1), LocalDate.of(2026, 1, 1));
        assertEquals("holiday", january.days().get(0).kind());
        assertEquals("makeup", january.days().get(3).kind());
        assertEquals("weekend", january.days().get(9).kind());
    }

    @Test
    void countdownIncludesCurrentHolidayThenAdvancesWithoutInventingNextYear() throws Exception {
        var calendar = service();
        var ongoing = calendar.build(YearMonth.of(2026, 1), LocalDate.of(2026, 1, 3)).nextHoliday();
        assertEquals("元旦", ongoing.name());
        assertEquals(0, ongoing.daysUntil());
        var next = calendar.build(YearMonth.of(2026, 1), LocalDate.of(2026, 1, 4)).nextHoliday();
        assertEquals("春节", next.name());
        assertEquals(42, next.daysUntil());
        assertNull(calendar.build(YearMonth.of(2026, 11), LocalDate.of(2026, 11, 2)).nextHoliday());
    }

    @Test
    void unknownYearPreservesRealCalendarAndLeapDayWithoutHolidayClaims() throws Exception {
        var result = service().build(YearMonth.of(2028, 2), LocalDate.of(2028, 2, 1));
        assertFalse(result.available());
        assertNull(result.source());
        assertNull(result.nextHoliday());
        assertEquals(29, result.days().size());
        assertEquals(LocalDate.of(2028, 2, 29), result.days().get(28).date());
        assertTrue(result.days().stream().noneMatch(day -> day.kind().equals("holiday") || day.kind().equals("makeup")));
        assertTrue(result.notice().contains("暂未收录"));
    }

    @Test
    void rejectsInvalidOrOutOfRangeMonthsAtBoundary() throws Exception {
        var calendar = service();
        for (var month : new String[]{"", "2026-13", "2026-2", "1899-12", "2101-01", "<script>"}) {
            var exception = assertThrows(ApiException.class, () -> calendar.calendar(month));
            assertEquals(400, exception.status());
        }
        assertNotNull(calendar.calendar(null).today());
    }
}
