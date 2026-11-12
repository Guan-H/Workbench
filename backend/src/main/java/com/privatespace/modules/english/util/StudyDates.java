package com.privatespace.modules.english.util;

import java.time.LocalDate;
import java.time.ZoneId;

/** All daily plans and spaced-review boundaries use the same Beijing calendar date. */
public final class StudyDates {
    private StudyDates() {}
    public static LocalDate today() { return LocalDate.now(ZoneId.of("Asia/Shanghai")); }
}
