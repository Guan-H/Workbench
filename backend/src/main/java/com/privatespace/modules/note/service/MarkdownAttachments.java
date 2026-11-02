package com.privatespace.modules.note.service;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.commonmark.node.AbstractVisitor;
import org.commonmark.node.Image;
import org.commonmark.node.Link;
import org.commonmark.parser.Parser;

/** Extract standard Markdown relative attachment references without following note links or remote URLs. */
public final class MarkdownAttachments {
    private MarkdownAttachments() {}

    public static Set<String> paths(String path, String content) {
        var result = new LinkedHashSet<String>();
        Parser.builder().build().parse(content).accept(new AbstractVisitor() {
            @Override
            public void visit(Image image) { include(image.getDestination()); }
            @Override
            public void visit(Link link) { include(link.getDestination()); visitChildren(link); }
            private void include(String destination) {
                try {
                    String raw = destination.split("[?#]", 2)[0];
                    String decoded = URLDecoder.decode(raw.replace("+", "%2B"), StandardCharsets.UTF_8);
                    if (decoded.isEmpty() || decoded.startsWith("/") || decoded.matches("^[a-zA-Z][a-zA-Z0-9+.-]*:.*")) return;
                    var parts = new ArrayList<>(List.of(path.split("/")));
                    parts.remove(parts.size() - 1);
                    for (String part : decoded.split("/")) {
                        if (part.equals("..")) { if (parts.isEmpty()) return; parts.remove(parts.size() - 1); }
                        else if (!part.equals(".") && !part.isEmpty()) parts.add(part);
                    }
                    String resolved = NotePaths.validate(String.join("/", parts));
                    if (!NotePaths.syncExcluded(resolved) && !resolved.toLowerCase(java.util.Locale.ROOT).endsWith(".md")) result.add(resolved);
                } catch (IllegalArgumentException | com.privatespace.common.exception.ApiException ignored) {
                    // Malformed references stay in the document and never grant a sync path.
                }
            }
        });
        return result;
    }
}
