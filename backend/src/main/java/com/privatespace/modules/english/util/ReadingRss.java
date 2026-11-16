package com.privatespace.modules.english.util;

import java.io.ByteArrayInputStream;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Element;

/** Reads only embedded RSS text; external entities and network references are forbidden. */
public final class ReadingRss {
    private ReadingRss() {}
    public record Item(String key, String title, String html, String url, String publishedAt) {}
    public static List<Item> parse(byte[] body) throws Exception {
        var factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setXIncludeAware(false);
        factory.setExpandEntityReferences(false);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        var builder = factory.newDocumentBuilder();
        builder.setErrorHandler(new org.xml.sax.helpers.DefaultHandler() {
            @Override public void fatalError(org.xml.sax.SAXParseException error) throws org.xml.sax.SAXException { throw error; }
        });
        var document = builder.parse(new ByteArrayInputStream(body));
        if (!"rss".equals(document.getDocumentElement().getTagName())) throw new IllegalStateException("来源不是 RSS");
        var items = document.getElementsByTagName("item");
        var result = new ArrayList<Item>();
        for (int index = 0; index < Math.min(5, items.getLength()); index++) {
            var row = (Element) items.item(index);
            String url = field(row, "link"), guid = field(row, "guid"), date = field(row, "pubDate");
            var content = row.getElementsByTagNameNS("http://purl.org/rss/1.0/modules/content/", "encoded");
            String html = content.getLength() == 0 ? "" : content.item(0).getTextContent();
            String published = date.isBlank() ? null : ZonedDateTime.parse(date, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toString();
            result.add(new Item(StudyIdentity.hash(guid.isBlank() ? url : guid), field(row, "title"), html, url, published));
        }
        return result;
    }
    private static String field(Element row, String name) {
        var values = row.getElementsByTagName(name);
        return values.getLength() == 0 ? "" : values.item(0).getTextContent().strip();
    }
}
