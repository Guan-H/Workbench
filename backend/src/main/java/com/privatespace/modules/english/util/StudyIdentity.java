package com.privatespace.modules.english.util;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Locale;
import com.privatespace.modules.english.dto.EnglishDtos.Word;

/** Stable identities merge repeated vocabulary while retaining separate senses. */
public final class StudyIdentity {
    private StudyIdentity() {}
    public static String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    public static String wordId(Word word) { return hash("word\n"+normalized(word.word())+"\n"+normalized(word.meaning())); }
    public static String normalized(String text) { return text.strip().replaceAll("(?U)\\s+"," ").toLowerCase(Locale.ROOT); }
}
