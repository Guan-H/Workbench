package com.privatespace.modules.settings.dto;

public final class AppearanceDtos {
    private AppearanceDtos() {}
    public record Settings(String desktop, String mobile, int desktopX, int desktopY,
            int mobileX, int mobileY, int overlay, String accent, String notes, String mindmap,
            int notesTransparency, int mindmapTransparency) {}
    public record Saved(long version, Settings settings) {}
    public record Write(long version, Settings settings) {}
    public record Image(String id) {}
}
