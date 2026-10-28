package com.privatespace.modules.note.service.impl;

import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;

import com.privatespace.modules.note.dto.MovePreviewResponse.LinkChange;
import com.privatespace.modules.note.entity.NoteFileEntity;
import org.commonmark.node.*;
import org.commonmark.parser.IncludeSourceSpans;
import org.commonmark.parser.Parser;

/** Replaces destination spans only. Never serializes the document or changes frontmatter/line endings. */
final class MarkdownLinkRewriter {
    private static final Pattern FRONTMATTER = Pattern.compile("\\A\\uFEFF?---\\r?\\n.*?\\r?\\n(?:---|\\.\\.\\.)[ \\t]*(?:\\r?\\n|$)", Pattern.DOTALL);
    private static final Pattern INLINE = Pattern.compile("\\]\\([ \\t]*(?:<([^<>\\r\\n]*)>|([^\\s<>]*?))(?:[ \\t]+(?:\"[^\"\\r\\n]*\"|'[^'\\r\\n]*'|\\([^()\\r\\n]*\\)))?[ \\t]*\\)$");
    private static final Pattern REFERENCE = Pattern.compile("^ {0,3}\\[[^\\]\\r\\n]+\\]:[ \\t]*(?:<([^<>\\r\\n]*)>|([^\\s<>]+))");
    private final Parser parser = Parser.builder().includeSourceSpans(IncludeSourceSpans.BLOCKS_AND_INLINES).build();

    record Result(String content, List<LinkChange> links, List<String> warnings) { }
    private record Edit(int start, int end, String text, LinkChange link) { }

    Result rewrite(String source, String oldPath, String newPath, Map<String, NoteFileEntity> catalog, Map<String, String> paths) {
        var edits = new TreeMap<Integer, Edit>();
        var warnings = new ArrayList<String>();
        var frontmatter = FRONTMATTER.matcher(source);
        int bodyStart = frontmatter.find() ? frontmatter.end() : 0;
        StringBuilder prefix = new StringBuilder();
        for (int index = 0; index < bodyStart; index++) {
            char character = source.charAt(index);
            prefix.append(character == '\r' || character == '\n' ? character : ' ');
        }
        String masked = prefix + source.substring(bodyStart);
        parser.parse(masked).accept(new AbstractVisitor() {
            @Override public void visit(Link link) { destination(link, link.getDestination(), false); visitChildren(link); }
            @Override public void visit(Image image) { destination(image, image.getDestination(), false); visitChildren(image); }
            @Override public void visit(LinkReferenceDefinition definition) { destination(definition, definition.getDestination(), true); }

            private void destination(Node node, String destination, boolean reference) {
                String replacement = relocate(destination, oldPath, newPath, catalog, paths, warnings);
                if (replacement.equals(destination)) return;
                var spans = node.getSourceSpans();
                if (spans.size() != 1) { warnings.add("多行链接未自动修改，请手动检查。"); return; }
                var span = spans.get(0);
                String raw = source.substring(span.getInputIndex(), span.getInputIndex() + span.getLength());
                int offset = reference ? 0 : raw.lastIndexOf("](");
                // Reference uses are repaired at the definition; code and HTML are not Link nodes.
                if (offset < 0) return;
                var match = (reference ? REFERENCE : INLINE).matcher(raw.substring(offset));
                if (!match.find()) { warnings.add("复杂链接写法未自动修改，请手动检查。"); return; }
                int group = match.group(1) != null ? 1 : 2;
                if (!destination.equals(match.group(group))) {
                    warnings.add("含转义或实体的链接未自动修改，请手动检查。"); return;
                }
                int start = span.getInputIndex() + offset + match.start(group);
                int end = span.getInputIndex() + offset + match.end(group);
                edits.put(start, new Edit(start, end, replacement, new LinkChange(span.getLineIndex() + 1, destination, replacement)));
            }
        });
        if (source.contains("[[")) warnings.add("含 Obsidian 双链，双链名称不会自动修改。");
        if (source.matches("(?s).*(?i:<a\\s|<img\\s).*")) warnings.add("含 HTML 链接写法，不会自动修改。");
        StringBuilder result = new StringBuilder(source);
        edits.values().stream().sorted(Comparator.comparingInt(Edit::start).reversed())
                .forEach(edit -> result.replace(edit.start(), edit.end(), edit.text()));
        return new Result(result.toString(), edits.values().stream().map(Edit::link).toList(), warnings.stream().distinct().toList());
    }

    private String relocate(String destination, String oldPath, String newPath, Map<String, NoteFileEntity> catalog,
            Map<String, String> paths, List<String> warnings) {
        if (destination.isEmpty() || destination.startsWith("#") || destination.matches("(?s)^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|/|\\\\).*")) return destination;
        int suffix = destination.length();
        for (char separator : new char[] {'?', '#'}) { int index = destination.indexOf(separator); if (index >= 0) suffix = Math.min(suffix, index); }
        String target;
        try { target = URLDecoder.decode(destination.substring(0, suffix).replace("+", "%2B"), StandardCharsets.UTF_8); }
        catch (IllegalArgumentException exception) { warnings.add("链接含无效编码，请手动检查。"); return destination; }
        String resolved = resolve(oldPath, target);
        var file = resolved == null ? null : catalog.get(resolved.toLowerCase(Locale.ROOT));
        if (file == null || file.deleted()) { warnings.add("未找到相对链接目标：" + destination); return destination; }
        String targetPath = paths.getOrDefault(file.id(), file.path());
        if (targetPath.equals(resolve(newPath, target))) return destination;
        var from = new ArrayList<>(Arrays.asList(newPath.split("/")));
        from.remove(from.size() - 1);
        var to = Arrays.asList(targetPath.split("/"));
        int common = 0;
        while (common < from.size() && common < to.size() && from.get(common).equals(to.get(common))) common++;
        var relative = new ArrayList<String>();
        for (int index = common; index < from.size(); index++) relative.add("..");
        for (int index = common; index < to.size(); index++) relative.add(URLEncoder.encode(to.get(index), StandardCharsets.UTF_8).replace("+", "%20").replace("%7E", "~"));
        return String.join("/", relative) + destination.substring(suffix);
    }

    private String resolve(String path, String target) {
        var parts = new ArrayList<>(Arrays.asList(path.split("/")));
        parts.remove(parts.size() - 1);
        for (String segment : target.split("/")) {
            if (segment.isEmpty() || segment.equals(".")) continue;
            if (segment.equals("..")) { if (parts.isEmpty()) return null; parts.remove(parts.size() - 1); }
            else parts.add(segment);
        }
        return String.join("/", parts);
    }
}
