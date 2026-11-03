"""Bounded whole-file HTTP transport for the M0 prototype."""

from __future__ import annotations

import json
from http.client import HTTPException
import urllib.error
import urllib.parse
import urllib.request


class SyncError(Exception):
    def __init__(self, code: str, status: int = 0):
        super().__init__(code)
        self.code = code
        self.status = status


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


class Remote:
    def __init__(self, url: str, token: str = ""):
        parsed = urllib.parse.urlsplit(url)
        if (parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment
                or parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost"))):
            raise SyncError("HTTPS_REQUIRED")
        self.url = url.rstrip("/")
        self.token = token
        self.scope_version: str | None = None
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, path: str, *, body=None, operation: str | None = None, binary: bool = False):
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        if self.scope_version is not None:
            headers['X-Sync-Scope-Version'] = self.scope_version
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if operation:
            headers["Idempotency-Key"] = operation
        request = urllib.request.Request(self.url + "/api/v1/sync" + path, data=data, headers=headers)
        try:
            with self.opener.open(request, timeout=15) as response:
                payload = response.read(71 * 1024 * 1024)
                length = response.headers.get('Content-Length')
                if length is not None and len(payload) != int(length):
                    raise SyncError('NETWORK_UNAVAILABLE')
                try:
                    return payload if binary else json.loads(payload)
                except (ValueError, UnicodeError):
                    raise SyncError('INVALID_SYNC_RESPONSE') from None
        except urllib.error.HTTPError as error:
            try:
                code = json.loads(error.read(16 * 1024)).get("code", "HTTP_ERROR")
            except (ValueError, UnicodeError):
                code = "HTTP_ERROR"
            raise SyncError(code, error.code) from None
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, HTTPException):
            raise SyncError("NETWORK_UNAVAILABLE") from None
