package com.privatespace.modules.note.service;

import java.text.Normalizer;
import java.util.List;
import java.util.Locale;

import com.privatespace.common.exception.ApiException;

/** Shared Windows-compatible logical path policy; never maps user input to object-store paths. */
public final class NotePaths {
    private NotePaths() { }

    public static String validate(String path) {
        if (path == null || path.length() > 240 || !Normalizer.isNormalized(path, Normalizer.Form.NFC)
                || path.startsWith("/") || path.contains("\\")) invalid();
        for (String segment : path.split("/", -1)) {
            if (segment.isBlank() || segment.equals(".") || segment.equals("..") || segment.endsWith(".") || segment.endsWith(" ")
                    || segment.matches(".*[<>:\"|?*\\p{Cntrl}].*") || segment.matches("(?i)(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\\..*)?")
                    || List.of(".git", ".obsidian").contains(segment.toLowerCase(Locale.ROOT))) invalid();
        }
        return path;
    }

    private static void invalid() {
        throw new ApiException(400, "INVALID_PATH", "路径不符合 Windows 文件名规则，或属于系统排除目录。");
    }
}
