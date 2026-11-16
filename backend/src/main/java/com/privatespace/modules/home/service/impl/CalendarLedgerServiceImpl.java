package com.privatespace.modules.home.service.impl;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.UUID;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.home.dto.CalendarLedgerDtos.*;
import com.privatespace.modules.home.mapper.CalendarLedgerMapper;
import com.privatespace.modules.home.mapper.CalendarRecordMapper;
import com.privatespace.modules.home.service.CalendarLedgerService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** Calendar totals and explicit opening balances share the record write lock, not a second ledger. */
@Service
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class CalendarLedgerServiceImpl implements CalendarLedgerService {
    private final CalendarLedgerMapper ledger;
    private final CalendarRecordMapper records;
    private final ObjectMapper json;
    public CalendarLedgerServiceImpl(CalendarLedgerMapper ledger, CalendarRecordMapper records, ObjectMapper json) {
        this.ledger = ledger; this.records = records; this.json = json;
    }
    private ApiException invalid() { return new ApiException(400,"INVALID_CALENDAR_BALANCE","请检查月份、起算日期及正负8760000小时范围内的整分钟期初余额。"); }
    private ApiException changed() { return new ApiException(409,"CALENDAR_BALANCE_CHANGED","记录或期初设置已变化，请保留输入并重新预览确认。"); }
    public Summary summary(String month) {
        YearMonth period;
        try { period = YearMonth.parse(month); if (!period.toString().equals(month) || period.getYear()<1900 || period.getYear()>2100) throw invalid(); }
        catch (RuntimeException error) { throw invalid(); }
        Opening opening = ledger.opening();
        Totals cumulative = ledger.totals(null,null);
        Totals scope = opening.startDate()==null ? cumulative : ledger.totals(opening.startDate(),null);
        long net = (opening.openingMinutes()==null?0:opening.openingMinutes()) + scope.overtimeMinutes()-scope.timeOffMinutes();
        return new Summary(month,ledger.totals(period.atDay(1),period.plusMonths(1).atDay(1)),cumulative,opening,Long.toString(ledger.revision()),net);
    }
    public History history(int page) {
        if (page<1 || page>1000000) throw invalid();
        return new History(ledger.months((page-1)*10),ledger.monthsCount(),page);
    }
    private LocalDate validate(Change request) {
        try {
            if (request==null || request.openingMinutes()==null || !request.baseVersion().matches("0|[1-9][0-9]{0,17}") || !request.recordsRevision().matches("0|[1-9][0-9]{0,17}")) throw invalid();
            LocalDate date=LocalDate.parse(request.startDate());
            if (!date.toString().equals(request.startDate()) || date.getYear()<1900 || date.getYear()>2100) throw invalid();
            if (request.openingMinutes() < -525600000L || request.openingMinutes()>525600000L) throw invalid(); // Bounded input also keeps the browser's integer arithmetic exact.
            return date;
        } catch (RuntimeException error) { throw invalid(); }
    }
    public Projection preview(Change request) {
        LocalDate start=validate(request);
        checkVersion(request);
        Totals totals=ledger.totals(start,null);
        return new Projection(request,totals.overtimeMinutes(),totals.timeOffMinutes(),request.openingMinutes()+totals.overtimeMinutes()-totals.timeOffMinutes());
    }
    private void checkVersion(Change request) {
        if (!Long.toString(ledger.opening().version()).equals(request.baseVersion()) || !Long.toString(ledger.revision()).equals(request.recordsRevision())) throw changed();
    }
    @Transactional
    public Opening save(Change request,String operation) {
        LocalDate start=validate(request);
        try { if (!UUID.fromString(operation).toString().equals(operation)) throw invalid(); } catch (RuntimeException error) { throw invalid(); }
        records.lock();
        String hash;
        try { hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(("calendar-opening\n"+json.writeValueAsString(request)).getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
        String previous=records.operationHash(operation);
        if (previous!=null) {
            if (!previous.equals(hash)) throw changed();
            return json.readValue(records.operationResult(operation),Opening.class);
        }
        checkVersion(request);
        ledger.save(start,request.openingMinutes());
        Opening result=ledger.opening();
        records.receipt(operation,hash,json.writeValueAsString(result));
        return result;
    }
}
