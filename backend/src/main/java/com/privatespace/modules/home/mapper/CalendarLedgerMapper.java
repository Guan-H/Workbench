package com.privatespace.modules.home.mapper;

import java.time.LocalDate;
import java.util.List;
import com.privatespace.modules.home.dto.CalendarLedgerDtos.*;
import org.apache.ibatis.annotations.*;

@Mapper
public interface CalendarLedgerMapper {
    @Select("SELECT version,start_date AS startDate,opening_minutes AS openingMinutes FROM calendar_opening_balance WHERE id=1") Opening opening();
    @Select("SELECT revision FROM calendar_record_lock WHERE id=1") long revision();
    @Select("SELECT COALESCE(SUM(overtime_minutes),0) AS overtimeMinutes,COALESCE(SUM(time_off_minutes),0) AS timeOffMinutes FROM calendar_record WHERE deleted=FALSE AND (#{from} IS NULL OR event_date>=#{from}) AND (#{to} IS NULL OR event_date<#{to})")
    Totals totals(@Param("from") LocalDate from, @Param("to") LocalDate to);
    @Select("SELECT DATE_FORMAT(event_date,'%Y-%m') AS month,SUM(overtime_minutes) AS overtimeMinutes,SUM(time_off_minutes) AS timeOffMinutes FROM calendar_record WHERE deleted=FALSE AND kind IN ('overtime','time-off') GROUP BY DATE_FORMAT(event_date,'%Y-%m') ORDER BY month DESC LIMIT 10 OFFSET #{offset}")
    List<Month> months(int offset);
    @Select("SELECT COUNT(DISTINCT DATE_FORMAT(event_date,'%Y-%m')) FROM calendar_record WHERE deleted=FALSE AND kind IN ('overtime','time-off')") long monthsCount();
    @Update("UPDATE calendar_opening_balance SET version=version+1,start_date=#{start},opening_minutes=#{minutes} WHERE id=1")
    void save(LocalDate start, long minutes);
}
