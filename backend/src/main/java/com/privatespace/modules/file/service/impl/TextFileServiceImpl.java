package com.privatespace.modules.file.service.impl;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.util.Arrays;
import java.util.Map;
import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.file.dto.TextFileRequest;
import com.privatespace.modules.file.service.TextFileService;
import com.privatespace.modules.note.dto.NoteResponse;
import com.privatespace.modules.note.service.NoteService;
import org.springframework.stereotype.Service;

/** TXT stays a binary attachment; strict decode/encode prevents silent replacement of characters. */
@Service
public class TextFileServiceImpl implements TextFileService {
    private final NoteService notes;
    public TextFileServiceImpl(NoteService notes) { this.notes = notes; }
    private NoteResponse textFile(String id) {
        var note = notes.read(id, true);
        if (note.deleted() || !note.type().equals("attachment") || !note.path().toLowerCase(java.util.Locale.ROOT).endsWith(".txt")) {
            throw new ApiException(400, "UNSUPPORTED_FORMAT", "仅 TXT 文件使用纯文本编辑入口。");
        }
        if (note.size() > 1024 * 1024) throw new ApiException(413, "FILE_TOO_LARGE", "在线 TXT 编辑最大 1 MiB，可下载原文件。");
        return note;
    }
    public Map<String, Object> read(String id, String requested) {
        var note = textFile(id);
        byte[] bytes = notes.versionBytes(id, note.version());
        String hex = java.util.HexFormat.of().formatHex(bytes, 0, Math.min(3, bytes.length));
        String detected = hex.startsWith("efbbbf") ? "UTF-8" : hex.startsWith("fffe") ? "UTF-16LE" : hex.startsWith("feff") ? "UTF-16BE" : "UTF-8";
        String encoding = "auto".equals(requested) ? detected : requested;
        Charset charset = charset(encoding);
        int skip = encoding.equals(detected) ? hex.startsWith("efbbbf") ? 3 : hex.startsWith("fffe") || hex.startsWith("feff") ? 2 : 0 : 0;
        try {
            String content = charset.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes, skip, bytes.length - skip)).toString();
            return Map.of("file", note, "content", content, "encoding", encoding, "bom", skip > 0);
        } catch (java.nio.charset.CharacterCodingException exception) {
            throw new ApiException(422, "TEXT_ENCODING_REQUIRED", "无法按所选编码读取，请选择正确编码；原文件未改动。");
        }
    }
    public NoteResponse save(String id, TextFileRequest request, String operation) {
        textFile(id);
        Charset charset = charset(request.encoding());
        try {
            ByteBuffer encoded = charset.newEncoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(request.content()));
            byte[] prefix = !request.bom() ? new byte[0] : switch (request.encoding()) {
                case "UTF-8" -> java.util.HexFormat.of().parseHex("efbbbf");
                case "UTF-16LE" -> java.util.HexFormat.of().parseHex("fffe");
                case "UTF-16BE" -> java.util.HexFormat.of().parseHex("feff");
                default -> throw new ApiException(400, "INVALID_ENCODING", "该编码不支持 BOM。");
            };
            byte[] bytes = Arrays.copyOf(prefix, prefix.length + encoded.remaining());
            encoded.get(bytes, prefix.length, encoded.remaining());
            if (bytes.length > 1024 * 1024) throw new ApiException(413, "FILE_TOO_LARGE", "在线 TXT 编辑最大 1 MiB。");
            return notes.replaceAttachment(id, request.path(), request.baseVersion(), bytes, operation);
        } catch (java.nio.charset.CharacterCodingException exception) {
            throw new ApiException(422, "TEXT_NOT_ENCODABLE", "该编码不能表示当前内容，请先另存草稿，再选择可用编码。");
        }
    }
    private Charset charset(String name) {
        if (!java.util.Set.of("UTF-8", "UTF-16LE", "UTF-16BE", "GB18030").contains(name)) throw new ApiException(400, "INVALID_ENCODING", "不支持该文本编码。");
        return Charset.forName(name);
    }
}
