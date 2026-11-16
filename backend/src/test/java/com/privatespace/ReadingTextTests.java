package com.privatespace;

import java.nio.ByteBuffer;
import java.util.List;
import java.util.concurrent.Flow;
import org.junit.jupiter.api.Test;
import com.privatespace.modules.english.util.ReadingHtml;
import com.privatespace.modules.english.util.ReadingResponseBody;
import com.privatespace.modules.english.util.ReadingRss;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ReadingTextTests {
    @Test void readsEmbeddedRssAndRejectsExternalEntities() throws Exception {
        String xml = "<rss xmlns:content='http://purl.org/rss/1.0/modules/content/'><channel><item><title>Reading</title><guid>item-1</guid><link>https://www.nasa.gov/a/</link><pubDate>Mon, 16 Nov 2026 05:00:00 +0000</pubDate><content:encoded><![CDATA[<p>A real paragraph.</p>]]></content:encoded></item></channel></rss>";
        var items = ReadingRss.parse(xml.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertThat(items).hasSize(1);
        assertThat(items.get(0).html()).isEqualTo("<p>A real paragraph.</p>");
        assertThat(items.get(0).publishedAt()).isEqualTo("2026-11-16T05:00:00Z");
        String forbidden = "<!DOCTYPE rss [<!ENTITY external SYSTEM 'file:///not-a-real-file'>]><rss><channel>&external;</channel></rss>";
        assertThatThrownBy(() -> ReadingRss.parse(forbidden.getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                .isInstanceOf(org.xml.sax.SAXException.class);
    }
    @Test void convertsRemoteHtmlToInertParagraphs() throws Exception {
        String text = ReadingHtml.text("<h2>A &amp; B</h2><p>One <b>small</b> step.</p><script>danger()</script><style>body{}</style><p>Next.<br>Line.</p>");
        assertThat(text).contains("A & B", "One small step.", "Next.\nLine.").doesNotContain("danger", "body{", "<b>");
    }
    @Test void boundsTheActualSubscriberBeforeBufferingAnOversizedResponse() {
        var body = new ReadingResponseBody();
        var cancelled = new java.util.concurrent.atomic.AtomicBoolean();
        body.onSubscribe(new Flow.Subscription() {
            public void request(long count) {}
            public void cancel() { cancelled.set(true); }
        });
        body.onNext(List.of(ByteBuffer.allocate(2 * 1024 * 1024 + 1)));
        assertThat(cancelled).isTrue();
        assertThat(body.getBody().toCompletableFuture()).isCompletedExceptionally();
    }
}
