package com.privatespace.modules.auth.mapper;

import com.privatespace.modules.auth.entity.AccountEntity;
import com.privatespace.modules.auth.entity.WebSessionEntity;
import java.util.List;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface AuthMapper {
    @Select("SELECT id, username, password_hash AS passwordHash FROM account WHERE id = 1")
    AccountEntity account();

    @Insert("INSERT INTO account (id, username, password_hash) VALUES (1, #{username}, #{hash})")
    void create(String username, String hash);

    @Insert("INSERT INTO web_session (token_hash, expires_at) VALUES (#{hash}, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 12 HOUR))")
    void session(String hash);

    String SESSION_FIELDS = "id, token_hash AS tokenHash, DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt, DATE_FORMAT(expires_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS expiresAt";

    @Select("SELECT " + SESSION_FIELDS + " FROM web_session WHERE expires_at > UTC_TIMESTAMP(6) ORDER BY (id = #{currentId}) DESC, created_at DESC, id DESC")
    List<WebSessionEntity> activeSessions(String currentId);

    @Select("SELECT " + SESSION_FIELDS + " FROM web_session WHERE token_hash = #{hash} AND expires_at > UTC_TIMESTAMP(6)")
    WebSessionEntity currentSession(String hash);

    @Delete("DELETE FROM web_session WHERE id = #{id} AND token_hash <> #{currentHash}")
    int revokeSession(String id, String currentHash);

    @Select("SELECT COUNT(*) FROM web_session WHERE token_hash = #{hash} AND expires_at > UTC_TIMESTAMP(6)")
    int validSession(String hash);

    @Delete("DELETE FROM web_session WHERE token_hash = #{hash}")
    void revoke(String hash);

    @Select("SELECT COUNT(*) FROM login_attempt WHERE client_key = #{key} AND blocked_until > UTC_TIMESTAMP(6)")
    int blocked(String key);

    @Insert("""
            INSERT INTO login_attempt (client_key, failures, blocked_until) VALUES (#{key}, 1, NULL)
            ON DUPLICATE KEY UPDATE
            failures = IF(blocked_until IS NOT NULL AND blocked_until < UTC_TIMESTAMP(6), 1, failures + 1),
            blocked_until = IF(failures >= 5, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 15 MINUTE), NULL)
            """)
    void failed(String key);

    @Delete("DELETE FROM login_attempt WHERE client_key = #{key}")
    void clearFailures(String key);
}
