package com.privatespace.modules.home.service.impl;

import java.io.IOException;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Map;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.home.dto.CalendarResponse;
import com.privatespace.modules.home.dto.CalendarResponse.Countdown;
import com.privatespace.modules.home.dto.CalendarResponse.Day;
import com.privatespace.modules.home.dto.CalendarResponse.Holiday;
import com.privatespace.modules.home.dto.CalendarResponse.Schedule;
import com.privatespace.modules.home.service.CalendarService;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Service
public class CalendarServiceImpl implements CalendarService {
    private static final ZoneId CHINA_ZONE = ZoneId.of("Asia/Shanghai");
    private final Map<Integer, Schedule> schedules;

    public CalendarServiceImpl(ObjectMapper json) throws IOException {
        var loaded = new HashMap<Integer, Schedule>();
        for (var resource : new PathMatchingResourcePatternResolver().getResources("classpath*:holidays/cn-*.json")) {
            try (var input = resource.getInputStream()) {
                var schedule = json.readValue(input, Schedule.class);
                if (loaded.putIfAbsent(schedule.year(), schedule) != null) {
                    throw new IllegalStateException("Duplicate official holiday schedule year");
                }
            }
        }
        schedules = Map.copyOf(loaded);
    }

    @Override
    public CalendarResponse calendar(String month) {
        var today = LocalDate.now(CHINA_ZONE);
        try {
            var selected = month == null ? YearMonth.from(today) : YearMonth.parse(month);
            if (selected.getYear() < 1900 || selected.getYear() > 2100) throw new DateTimeParseException("Year out of range", selected.toString(), 0);
            return build(selected, today);
        } catch (DateTimeParseException exception) {
            throw new ApiException(400, "INVALID_MONTH", "请选择 1900–2100 年之间的月份，格式为 YYYY-MM。");
        }
    }

    // Keep date arithmetic independent of the live clock so boundary days can run through real rules in tests.
    CalendarResponse build(YearMonth month, LocalDate today) {
        var schedule = schedules.get(month.getYear());
        var days = new ArrayList<Day>();
        for (int day = 1; day <= month.lengthOfMonth(); day++) {
            var date = month.atDay(day);
            Holiday holiday = schedule == null ? null : schedule.holidays().stream()
                    .filter(item -> !date.isBefore(item.start()) && !date.isAfter(item.end())).findFirst().orElse(null);
            String kind = holiday != null ? "holiday" : schedule != null && schedule.makeupDays().contains(date)
                    ? "makeup" : date.getDayOfWeek().getValue() >= 6 ? "weekend" : "weekday";
            days.add(new Day(date, day, date.getDayOfWeek().getValue(), kind, holiday == null ? null : holiday.name()));
        }
        // Only consecutive, collected years can establish the next holiday. A missing year is not skipped.
        var future = new ArrayList<Holiday>();
        for (int year = today.getYear(); year <= today.getYear() + 1 && schedules.containsKey(year); year++) {
            future.addAll(schedules.get(year).holidays());
        }
        var next = future.stream().filter(item -> !item.end().isBefore(today))
                .min(Comparator.comparing(Holiday::start))
                .map(item -> new Countdown(item.name(), item.start(), item.end(), Math.max(0, ChronoUnit.DAYS.between(today, item.start()))))
                .orElse(null);
        String notice = schedule == null ? month.getYear() + " 年节假日安排暂未收录，待官方公布并核对后补充；不推算放假或调休。"
                : "中国大陆放假及调休安排；周末单独标记，不等同于法定节假日。";
        return new CalendarResponse(month.toString(), today, CHINA_ZONE.getId(), schedule != null,
                schedule == null ? null : schedule.source(), days, next, notice);
    }
}
