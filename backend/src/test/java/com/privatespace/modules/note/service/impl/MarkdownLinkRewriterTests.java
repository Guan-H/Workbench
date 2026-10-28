package com.privatespace.modules.note.service.impl;

import java.util.Map;

import com.privatespace.modules.note.entity.NoteFileEntity;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class MarkdownLinkRewriterTests {
    private final MarkdownLinkRewriter rewriter = new MarkdownLinkRewriter();

    @Test
    void preservesFrontmatterEmojiCrlfCodeAndTitlesWhileRewritingParsedDestinations() {
        String source = "\uFEFF---\r\nemoji: 📝\r\nurl: '[保留](原名.md)'\r\n---\r\n"
                + "[链接](原名.md#段落 \"标题\")\r\n![图](<原名.md>)\r\n"
                + "[引用][r]\r\n\r\n[r]: <原名.md> \"引用标题\"\r\n\r\n"
                + "`[代码](原名.md)`\r\n```md\r\n[围栏](原名.md)\r\n```\r\n[[原名]]\r\n";
        var target = file("target", "原名.md");
        var result = rewriter.rewrite(source, "引用.md", "引用.md", Map.of("原名.md", target), Map.of("target", "新目录/新名.md"));
        assertThat(result.content()).startsWith(source.substring(0, source.indexOf("---\r\n", 5) + 5));
        assertThat(result.content()).contains("[链接](%E6%96%B0%E7%9B%AE%E5%BD%95/%E6%96%B0%E5%90%8D.md#段落 \"标题\")",
                "![图](<%E6%96%B0%E7%9B%AE%E5%BD%95/%E6%96%B0%E5%90%8D.md>)",
                "[r]: <%E6%96%B0%E7%9B%AE%E5%BD%95/%E6%96%B0%E5%90%8D.md> \"引用标题\"",
                "`[代码](原名.md)`", "```md\r\n[围栏](原名.md)\r\n```", "[[原名]]");
        assertThat(result.links()).hasSize(3);
        assertThat(result.warnings()).anyMatch(warning -> warning.contains("双链"));
    }

    @Test
    void adjustsOutgoingLinksWithoutTouchingAbsoluteUrlsOrAnchors() {
        var image = file("image", "assets/图.png");
        var result = rewriter.rewrite("![图](assets/%E5%9B%BE.png)\n[外部](https://example.invalid)\n[段落](#标题)\n",
                "文章.md", "目录/文章.md", Map.of("assets/图.png", image), Map.of());
        assertThat(result.content()).isEqualTo("![图](../assets/%E5%9B%BE.png)\n[外部](https://example.invalid)\n[段落](#标题)\n");
    }

    private NoteFileEntity file(String id, String path) {
        return new NoteFileEntity(id, path, "note", 1, null, null, false, false, null, null, 0, null);
    }
}
