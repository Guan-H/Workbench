package com.privatespace.modules.english.mapper;

import org.apache.ibatis.annotations.*;
import com.privatespace.modules.english.entity.ReadingSourceEntity;

@Mapper
public interface ReadingSourceMapper {
    @Select("SELECT id,revision,enabled,running_since AS runningSince,last_attempt_at AS lastAttemptAt,last_success_at AS lastSuccessAt,retry_after_at AS retryAfterAt,last_added AS lastAdded,last_skipped AS lastSkipped,last_error AS lastError FROM english_reading_source WHERE id='nasa'")
    ReadingSourceEntity state();
    @Update("UPDATE english_reading_source SET enabled=#{enabled},revision=revision+1 WHERE id='nasa' AND revision=#{revision}")
    int configure(long revision, boolean enabled);
    @Update("UPDATE english_reading_source SET running_since=UTC_TIMESTAMP(6),last_attempt_at=UTC_TIMESTAMP(6),last_error=NULL WHERE id='nasa' AND (running_since IS NULL OR running_since < UTC_TIMESTAMP(6)-INTERVAL 2 MINUTE) AND (retry_after_at IS NULL OR retry_after_at<=UTC_TIMESTAMP(6))")
    int begin();
    @Update("UPDATE english_reading_source SET running_since=NULL,last_success_at=UTC_TIMESTAMP(6),retry_after_at=NULL,last_added=#{added},last_skipped=#{skipped},last_error=NULL WHERE id='nasa'")
    void success(int added, int skipped);
    @Update("UPDATE english_reading_source SET running_since=NULL,last_added=#{added},last_skipped=#{skipped},last_error=#{error} WHERE id='nasa'")
    void failure(int added, int skipped, String error);
    @Update("UPDATE english_reading_source SET running_since=NULL,retry_after_at=#{until},last_added=0,last_skipped=0,last_error='来源暂时限流或繁忙，请在等待时间结束后重试。' WHERE id='nasa'")
    void rateLimited(java.time.LocalDateTime until);
}
