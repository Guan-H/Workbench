package com.privatespace.modules.english.util;

import java.io.IOException;
import java.io.StringReader;
import javax.swing.text.MutableAttributeSet;
import javax.swing.text.html.HTML;
import javax.swing.text.html.HTMLEditorKit;
import javax.swing.text.html.parser.ParserDelegator;

/** Remote HTML is reduced to inert text; no remote images, scripts or styles are forwarded. */
public final class ReadingHtml {
    private ReadingHtml() {}
    public static String text(String html) throws IOException {
        // The legacy JDK parser can treat misplaced style bodies as visible text.
        String cleaned = html.replaceAll("(?is)<(script|style|noscript|iframe)\\b[^>]*>.*?</\\1\\s*>", " ");
        StringBuilder result = new StringBuilder();
        new ParserDelegator().parse(new StringReader(cleaned), new HTMLEditorKit.ParserCallback() {
            private boolean ignored;
            @Override public void handleStartTag(HTML.Tag tag, MutableAttributeSet attributes, int position) {
                if (tag == HTML.Tag.SCRIPT || tag == HTML.Tag.STYLE) ignored = true;
                if (tag == HTML.Tag.P || tag == HTML.Tag.DIV || tag == HTML.Tag.H2 || tag == HTML.Tag.H3 || tag == HTML.Tag.LI) result.append("\n");
            }
            @Override public void handleEndTag(HTML.Tag tag, int position) {
                if (tag == HTML.Tag.SCRIPT || tag == HTML.Tag.STYLE) ignored = false;
                if (tag == HTML.Tag.P || tag == HTML.Tag.DIV || tag == HTML.Tag.H2 || tag == HTML.Tag.H3 || tag == HTML.Tag.LI) result.append("\n");
            }
            @Override public void handleSimpleTag(HTML.Tag tag, MutableAttributeSet attributes, int position) {
                if (tag == HTML.Tag.BR) result.append("\n");
            }
            @Override public void handleText(char[] data, int position) {
                if (!ignored) result.append(data);
            }
        }, true);
        return result.toString().replaceAll("[\\t\\x0B\\f\\r ]+", " ").replaceAll(" *\\n *", "\n").replaceAll("\\n{3,}", "\n\n").strip();
    }
}
