package com.privatespace.config;

import jakarta.validation.constraints.Min;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties("private-space.vault-retention")
public class VaultRetentionProperties {
    private boolean enabled = true;
    @Min(1) private int historyDays = 30;
    @Min(1) private int recycleDays = 30;
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public int getHistoryDays() { return historyDays; }
    public void setHistoryDays(int historyDays) { this.historyDays = historyDays; }
    public int getRecycleDays() { return recycleDays; }
    public void setRecycleDays(int recycleDays) { this.recycleDays = recycleDays; }
}
