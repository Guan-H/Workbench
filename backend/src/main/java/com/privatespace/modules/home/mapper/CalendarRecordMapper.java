package com.privatespace.modules.home.mapper;

import java.time.LocalDate;
import java.util.List;
import com.privatespace.modules.home.entity.CalendarRecordEntity;
import com.privatespace.modules.home.dto.CalendarRecordDtos.DaySummary;
import org.apache.ibatis.annotations.*;

@Mapper
public interface CalendarRecordMapper {
    String COLUMNS = "id,kind,event_date AS eventDate,title,notes,task_time AS taskTime,completed,started_at AS startedAt,ended_at AS endedAt,break_minutes AS breakMinutes,overtime_minutes AS overtimeMinutes,version,deleted";
    @Select("SELECT id FROM calendar_record_lock WHERE id=1 FOR UPDATE") int lock();
    @Select("SELECT " + COLUMNS + " FROM calendar_record WHERE id=#{id}") CalendarRecordEntity find(String id);
    @Select("SELECT " + COLUMNS + " FROM calendar_record WHERE deleted=FALSE AND event_date>=#{from} AND event_date<#{to} ORDER BY event_date,COALESCE(task_time,TIME_FORMAT(started_at,'%H:%i'),'00:00'),id LIMIT 10 OFFSET #{offset}")
    List<CalendarRecordEntity> list(LocalDate from, LocalDate to, int offset);
    @Select("SELECT COUNT(*) FROM calendar_record WHERE deleted=FALSE AND event_date>=#{from} AND event_date<#{to}") long total(LocalDate from, LocalDate to);
    @Select("SELECT CAST(event_date AS CHAR) AS date,SUM(kind='todo') AS todos,SUM(kind='todo' AND completed=FALSE) AS pending,SUM(kind='other') AS others,SUM(kind='overtime') AS overtimes,SUM(overtime_minutes) AS overtimeMinutes FROM calendar_record WHERE deleted=FALSE AND event_date>=#{from} AND event_date<#{to} GROUP BY event_date ORDER BY event_date")
    List<DaySummary> days(LocalDate from, LocalDate to);
    @Select("SELECT id,kind,eventDate,title,notes,taskTime,completed,startedAt,endedAt,breakMinutes,overtimeMinutes,version,deleted FROM (SELECT " + COLUMNS + ",ROW_NUMBER() OVER(PARTITION BY event_date ORDER BY COALESCE(task_time,TIME_FORMAT(started_at,'%H:%i'),'00:00'),id) AS previewRow FROM calendar_record WHERE deleted=FALSE AND event_date>=#{from} AND event_date<#{to}) ranked WHERE previewRow<=3 ORDER BY eventDate,previewRow")
    List<CalendarRecordEntity> previews(LocalDate from, LocalDate to);
    @Insert("INSERT INTO calendar_record(id,kind,event_date,title,notes,task_time,completed,started_at,ended_at,break_minutes,overtime_minutes,version) VALUES(#{id},#{kind},#{eventDate},#{title},#{notes},#{taskTime},#{completed},#{startedAt},#{endedAt},#{breakMinutes},#{overtimeMinutes},1)") void create(CalendarRecordEntity row);
    @Update("UPDATE calendar_record SET kind=#{kind},event_date=#{eventDate},title=#{title},notes=#{notes},task_time=#{taskTime},completed=#{completed},started_at=#{startedAt},ended_at=#{endedAt},break_minutes=#{breakMinutes},overtime_minutes=#{overtimeMinutes},version=version+1,updated_at=UTC_TIMESTAMP(6) WHERE id=#{id}") void save(CalendarRecordEntity row);
    @Update("UPDATE calendar_record SET deleted=TRUE,version=version+1,updated_at=UTC_TIMESTAMP(6) WHERE id=#{id}") void delete(String id);
    @Select("SELECT request_hash FROM calendar_record_operation WHERE operation=#{operation}") String operationHash(String operation);
    @Select("SELECT result FROM calendar_record_operation WHERE operation=#{operation}") String operationResult(String operation);
    @Insert("INSERT INTO calendar_record_operation(operation,request_hash,result) VALUES(#{operation},#{hash},#{result})") void receipt(String operation, String hash, String result);
}
