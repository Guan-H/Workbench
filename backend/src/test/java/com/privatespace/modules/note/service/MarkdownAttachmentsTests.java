package com.privatespace.modules.note.service;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class MarkdownAttachmentsTests {
    @Test
    void resolvesStandardImagesLinksAndReferenceDefinitionsWithoutChangingLibraryPaths() {
        var paths = MarkdownAttachments.paths("工作/笔记.md", "![图](../公共/图%20片.png) [附件](../公共/a+b.pdf)\n\n![引用][img]\n\n[img]: ../公共/引用.png\n");
        assertEquals(java.util.Set.of("公共/图 片.png", "公共/a+b.pdf", "公共/引用.png"), paths);
    }

    @Test
    void doesNotGrantRemoteNoteEscapingOrCodeOnlyReferences() {
        var paths = MarkdownAttachments.paths("工作/笔记.md", "![外链](https://example.invalid/a.png) [笔记](../别处.md) ![越界](../../x.png) ![编码协议](https%3A%2F%2Fexample.invalid%2Fa.png) ![系统目录](../node_modules/a.png) ![临时文件](../公共/a.tmp)\n\n```md\n![代码](../公共/代码.png)\n```\n");
        assertTrue(paths.isEmpty());
    }
}
