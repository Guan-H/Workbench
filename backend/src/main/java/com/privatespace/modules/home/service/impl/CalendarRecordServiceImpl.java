package com.privatespace.modules.home.service.impl;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.home.dto.CalendarRecordDtos.*;
import com.privatespace.modules.home.entity.CalendarRecordEntity;
import com.privatespace.modules.home.mapper.CalendarRecordMapper;
import com.privatespace.modules.home.service.CalendarRecordService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** Version checks and receipts preserve edits when a request is retried or another browser writes. */
@Service
public class CalendarRecordServiceImpl implements CalendarRecordService {
    private static final DateTimeFormatter MINUTE = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm");
    private final CalendarRecordMapper mapper;
    private final ObjectMapper json;
    public CalendarRecordServiceImpl(CalendarRecordMapper mapper, ObjectMapper json) { this.mapper = mapper; this.json = json; }
    private ApiException invalid() { return new ApiException(400, "INVALID_CALENDAR_RECORD", "请检查日期、标题和时间：标题最多 200 字，备注最多 4000 字；加班时长须大于 0，且不能超过开始至结束的时间跨度。"); }
    private void id(String value) { try { if (!UUID.fromString(value).toString().equals(value)) throw invalid(); } catch (RuntimeException error) { throw invalid(); } }
    private LocalDate date(String value) {
        try { var result = LocalDate.parse(value); if (!result.toString().equals(value) || result.getYear() < 1900 || result.getYear() > 2100) throw invalid(); return result; }
        catch (RuntimeException error) { throw invalid(); }
    }
    private YearMonth month(String value) {
        try { var result = YearMonth.parse(value); if (!result.toString().equals(value) || result.getYear() < 1900 || result.getYear() > 2100) throw invalid(); return result; }
        catch (RuntimeException error) { throw invalid(); }
    }
    private LocalDateTime minute(String value) {
        try { var result = LocalDateTime.parse(value); if (!MINUTE.format(result).equals(value)) throw invalid(); date(result.toLocalDate().toString()); return result; }
        catch (RuntimeException error) { throw invalid(); }
    }
    private Item item(CalendarRecordEntity row) {
        return new Item(row.id(), Long.toString(row.version()), row.kind(), row.eventDate().toString(), row.title(), row.notes(), row.taskTime(), row.completed(),
                row.startedAt() == null ? null : MINUTE.format(row.startedAt()), row.endedAt() == null ? null : MINUTE.format(row.endedAt()), row.overtimeMinutes(), row.deleted());
    }
    private Preview preview(CalendarRecordEntity row) {
        return new Preview(row.kind(), row.title(), row.taskTime(), row.completed(),
                row.startedAt() == null ? null : MINUTE.format(row.startedAt()),
                row.endedAt() == null ? null : MINUTE.format(row.endedAt()), row.overtimeMinutes());
    }
    @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public Page list(String month, String date, int page) {
        var period = month(month);
        if (page < 1 || page > 1000000) throw invalid();
        var from = date == null ? period.atDay(1) : date(date);
        if (!YearMonth.from(from).equals(period)) throw invalid();
        var to = date == null ? period.plusMonths(1).atDay(1) : from.plusDays(1);
        var monthFrom = period.atDay(1);
        var monthTo = period.plusMonths(1).atDay(1);
        Map<LocalDate, List<Preview>> previews = mapper.previews(monthFrom, monthTo).stream()
                .collect(Collectors.groupingBy(CalendarRecordEntity::eventDate, Collectors.mapping(this::preview, Collectors.toList())));
        var summaries = mapper.days(monthFrom, monthTo);
        var days = summaries.stream().map(day -> new Day(day.date(), day.todos(), day.pending(), day.others(), day.overtimes(), day.overtimeMinutes(),
                previews.getOrDefault(LocalDate.parse(day.date()), List.of()))).toList();
        return new Page(month, days, summaries.stream().mapToLong(DaySummary::overtimeMinutes).sum(), mapper.list(from, to, (page - 1) * 10).stream().map(this::item).toList(), mapper.total(from, to), page);
    }
    private String hash(Object value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(json.writeValueAsString(value).getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }
    private Item begin(String operation, String hash) {
        id(operation); mapper.lock();
        var previous = mapper.operationHash(operation);
        if (previous == null) return null;
        if (!previous.equals(hash)) throw new ApiException(409, "CALENDAR_OPERATION_REUSED", "操作编号已用于其他内容，请重新读取并核对。");
        return json.readValue(mapper.operationResult(operation), Item.class);
    }
    private CalendarRecordEntity required(String id, String baseVersion) {
        var row = mapper.find(id);
        if (row == null) throw new ApiException(404, "CALENDAR_RECORD_NOT_FOUND", "记录不存在，请重新读取。");
        if (!Long.toString(row.version()).equals(baseVersion) || row.deleted()) throw new ApiException(409, "CALENDAR_RECORD_CHANGED", "记录已被修改或删除，当前输入保留，请重新读取并核对。");
        return row;
    }
    private Item finish(String id, String operation, String hash) {
        var result = item(mapper.find(id)); mapper.receipt(operation, hash, json.writeValueAsString(result)); return result;
    }
    @Transactional
    public Item save(String id, Write request, String operation) {
        id(id);
        if (request == null || request.baseVersion() == null || request.title() == null || request.title().isBlank() || request.title().length() > 200 || request.notes() == null || request.notes().length() > 4000) throw invalid();
        var day = date(request.date());
        LocalDateTime start = null, end = null; String time = null; int minutes = 0;
        if ("todo".equals(request.kind()) || "other".equals(request.kind())) {
            if (request.start() != null || request.end() != null || request.overtimeMinutes() != null || ("other".equals(request.kind()) && request.completed())) throw invalid();
            if (request.time() != null) {
                try { if (!LocalTime.parse(request.time()).format(DateTimeFormatter.ofPattern("HH:mm")).equals(request.time())) throw invalid(); } catch (RuntimeException error) { throw invalid(); }
                time = request.time();
            }
        } else if ("overtime".equals(request.kind())) {
            if (request.time() != null || request.completed() || request.overtimeMinutes() == null) throw invalid();
            try { minutes = request.overtimeMinutes().intValueExact(); } catch (ArithmeticException error) { throw invalid(); }
            start = minute(request.start()); end = minute(request.end());
            long duration = Duration.between(start, end).toMinutes();
            if (!start.toLocalDate().equals(day) || duration <= 0 || minutes <= 0 || minutes > duration) throw invalid();
        } else throw invalid();
        String hash = hash(List.of("save", id, request));
        var previous = begin(operation, hash); if (previous != null) return previous;
        var row = new CalendarRecordEntity(id, request.kind(), day, request.title().trim(), request.notes(), time, request.completed(), start, end, 0, minutes, 1, false);
        if (mapper.find(id) == null && "0".equals(request.baseVersion())) mapper.create(row);
        else { required(id, request.baseVersion()); mapper.save(row); }
        return finish(id, operation, hash);
    }
    @Transactional
    public Item delete(String id, Version request, String operation) {
        id(id); if (request == null || request.baseVersion() == null) throw invalid();
        String hash = hash(List.of("delete", id, request.baseVersion()));
        var previous = begin(operation, hash); if (previous != null) return previous;
        required(id, request.baseVersion()); mapper.delete(id); return finish(id, operation, hash);
    }
}
