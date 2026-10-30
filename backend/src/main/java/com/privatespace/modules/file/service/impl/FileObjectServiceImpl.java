package com.privatespace.modules.file.service.impl;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;

import com.privatespace.common.exception.ApiException;
import com.privatespace.config.StorageProperties;
import com.privatespace.modules.file.entity.FileObjectEntity;
import com.privatespace.modules.file.mapper.FileObjectMapper;
import com.privatespace.modules.file.service.FileObjectService;
import org.springframework.stereotype.Service;

@Service
public class FileObjectServiceImpl implements FileObjectService {
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(FileObjectServiceImpl.class);
    private final Path root;
    private final FileObjectMapper mapper;

    public FileObjectServiceImpl(StorageProperties properties, FileObjectMapper mapper) throws IOException {
        this.root = properties.path().toAbsolutePath().normalize();
        Files.createDirectories(root);
        this.mapper = mapper;
    }

    public FileObjectEntity write(byte[] content) {
        Path temporary = null;
        try {
            if (Files.getFileStore(root).getUsableSpace() < content.length + 10L * 1024 * 1024) {
                throw new ApiException(507, "INSUFFICIENT_STORAGE", "存储空间不足，请释放空间后重试。");
            }
            String id = UUID.randomUUID().toString();
            Path target = path(id);
            Files.createDirectories(target.getParent());
            if (Files.isSymbolicLink(target.getParent())) throw new IOException("Unsafe object directory");
            temporary = Files.createTempFile(target.getParent(), ".upload-", ".tmp");
            try (var channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(content);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE);
            temporary = null;
            var object = new FileObjectEntity(id, digest(content), content.length);
            mapper.insert(object);
            return object;
        } catch (IOException exception) {
            throw new ApiException(507, "INSUFFICIENT_STORAGE", "无法写入私有文件卷，请检查空间和目录权限。");
        } finally {
            if (temporary != null) {
                try { Files.deleteIfExists(temporary); }
                catch (IOException exception) { LOG.warn("Unpublished object temporary file cleanup failed; storage maintenance required"); }
            }
        }
    }

    public byte[] read(String id) {
        FileObjectEntity object = mapper.find(UUID.fromString(id).toString());
        if (object == null) throw new ApiException(503, "OBJECT_UNAVAILABLE", "文件对象不存在，请检查备份与存储卷。");
        try {
            Path file = path(id);
            if (Files.isSymbolicLink(file) || Files.isSymbolicLink(file.getParent())) throw new IOException("Unsafe object");
            byte[] bytes = Files.readAllBytes(file);
            if (bytes.length != object.size() || !digest(bytes).equals(object.sha256())) throw new IOException("Object checksum mismatch");
            return bytes;
        } catch (IOException exception) {
            throw new ApiException(503, "OBJECT_UNAVAILABLE", "文件读取或校验失败，当前版本已保留，请检查存储卷。");
        }
    }

    public boolean deleteIfUnreferenced(String id) {
        String safe = UUID.fromString(id).toString();
        if (mapper.deleteUnreferenced(safe) == 0) return false;
        try {
            Files.deleteIfExists(path(safe));
        } catch (IOException exception) {
            LOG.warn("Unreferenced object file could not be removed; a later orphan sweep will retry", exception);
        }
        return true;
    }

    public int deletePhysicalOrphans(Instant cutoff) {
        int removed = 0;
        try (var paths = Files.walk(root, 2)) {
            for (Path candidate : paths.filter(Files::isRegularFile).toList()) {
                if (Files.isSymbolicLink(candidate) || Files.isSymbolicLink(candidate.getParent())) continue;
                String name = candidate.getFileName().toString();
                String id;
                try { id = UUID.fromString(name).toString(); }
                catch (IllegalArgumentException ignored) { continue; }
                if (!candidate.toAbsolutePath().normalize().equals(path(id)) ||
                        !Files.getLastModifiedTime(candidate).toInstant().isBefore(cutoff) || mapper.find(id) != null) continue;
                if (Files.deleteIfExists(candidate)) removed++;
            }
        } catch (IOException exception) {
            LOG.warn("Physical orphan scan did not complete; published objects were not touched", exception);
        }
        return removed;
    }

    private Path path(String id) {
        String safe = UUID.fromString(id).toString();
        return root.resolve(safe.substring(0, 2)).resolve(safe);
    }

    private String digest(byte[] content) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content)); }
        catch (java.security.NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }
}
