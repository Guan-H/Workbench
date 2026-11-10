package com.privatespace.modules.reader.service.impl;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.note.dto.NoteResponse;
import com.privatespace.modules.note.service.NoteService;
import com.privatespace.modules.reader.dto.ReadingProgressRequest;
import com.privatespace.modules.reader.dto.ReadingProgressResponse;
import com.privatespace.modules.reader.entity.ReadingProgressEntity;
import com.privatespace.modules.reader.mapper.ReadingProgressMapper;
import com.privatespace.modules.reader.service.ReadingProgressService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class ReadingProgressServiceImpl implements ReadingProgressService {
    private final NoteService notes;
    private final ReadingProgressMapper mapper;
    private final ObjectMapper json;

    public ReadingProgressServiceImpl(NoteService notes, ReadingProgressMapper mapper, ObjectMapper json) {
        this.notes = notes;
        this.mapper = mapper;
        this.json = json;
    }

    private NoteResponse file(String id) {
        var file = notes.metadata(id);
        if (!NovelLibraryServiceImpl.supported(file)) {
            throw new ApiException(404, "NOT_FOUND", "书籍文件不存在或不支持阅读。");
        }
        return file;
    }

    public ReadingProgressResponse read(String id) {
        file(id);
        return response(mapper.find(id));
    }

    @Transactional
    public ReadingProgressResponse save(String id, ReadingProgressRequest request, String operation) {
        var file = file(id);
        try { UUID.fromString(operation); }
        catch (RuntimeException exception) { throw new ApiException(400, "INVALID_OPERATION", "阅读操作标识无效。"); }
        if (request.baseRevision() == null || request.sourceVersion() == null || request.sourceHash() == null || request.format() == null) {
            throw new ApiException(400, "INVALID_PROGRESS", "阅读位置参数不完整。");
        }
        String hash;
        try {
            var locator = json.readTree(request.locator());
            if (locator.path("v").asInt() != 1 || !locator.path("part").isString() || locator.path("part").asText().length() > 1024
                    || !locator.path("block").isIntegralNumber() || !locator.path("offset").isIntegralNumber()
                    || locator.path("block").asLong() < 0 || locator.path("block").asLong() > 10000000
                    || locator.path("offset").asLong() < 0 || locator.path("offset").asLong() > 1000000
                    || !java.util.Set.of("auto", "UTF-8", "GB18030", "UTF-16LE", "UTF-16BE").contains(locator.path("encoding").asText())) {
                throw new IllegalArgumentException();
            }
            hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(json.writeValueAsString(request).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) { throw new ApiException(400, "INVALID_PROGRESS", "阅读位置格式无效。"); }
        mapper.ensure(id);
        var previous = mapper.lock(id);
        if (operation.equals(previous.operation())) {
            if (!hash.equals(previous.requestHash())) throw new ApiException(409, "OPERATION_REUSED", "该阅读操作标识已用于不同内容。");
            return response(previous);
        }
        if (!file.version().equals(request.sourceVersion()) || !file.sha256().equals(request.sourceHash())
                || !file.path().toLowerCase(Locale.ROOT).endsWith("." + request.format())) {
            throw new ApiException(409, "READING_FILE_CHANGED", "书籍内容或格式已变化，请重新打开；旧位置已保留。");
        }
        if (previous.revision() != Long.parseLong(request.baseRevision())) {
            throw new ApiException(409, "READING_PROGRESS_CHANGED", "另一页面或设备已更新阅读位置，请核对后继续。");
        }
        mapper.save(id, request.sourceHash(), request.format(), request.locator(), operation, hash);
        return response(mapper.find(id));
    }

    private ReadingProgressResponse response(ReadingProgressEntity entity) {
        return entity == null ? new ReadingProgressResponse("0", null, null, null, null, null)
                : new ReadingProgressResponse(Long.toString(entity.revision()), entity.sourceHash(), entity.format(), entity.locator(), entity.operation(), entity.updatedAt());
    }
}
