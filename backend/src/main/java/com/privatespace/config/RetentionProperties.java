package com.privatespace.config;

import java.time.Duration;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.AssertTrue;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties("private-space.retention")
public class RetentionProperties {
    private boolean enabled = true;
    @Min(1) private int historyDays = 30;
    @Min(1) private int recycleDays = 30;
    @Min(1) private int orphanDays = 30;
    @NotNull private Duration exportLease = Duration.ofHours(2);

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public int getHistoryDays() { return historyDays; }
    public void setHistoryDays(int historyDays) { this.historyDays = historyDays; }
    public int getRecycleDays() { return recycleDays; }
    public void setRecycleDays(int recycleDays) { this.recycleDays = recycleDays; }
    public int getOrphanDays() { return orphanDays; }
    public void setOrphanDays(int orphanDays) { this.orphanDays = orphanDays; }
    public Duration getExportLease() { return exportLease; }
    public void setExportLease(Duration exportLease) { this.exportLease = exportLease; }
    @AssertTrue(message = "export lease must be positive")
    public boolean isExportLeasePositive() { return exportLease != null && !exportLease.isZero() && !exportLease.isNegative(); }
}
