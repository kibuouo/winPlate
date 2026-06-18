import gzip
import base64
import secrets
import json
import os
import re
import sqlite3
import threading
import time
from copy import deepcopy
from contextlib import closing
from calendar import monthrange
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html import escape, unescape
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import uvicorn
import jwt
from uvicorn.config import LOGGING_CONFIG
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel


DATABASE_PATH = Path(__file__).with_name("winplate.db")
GITHUB_API_URL = "https://api.github.com"
GITHUB_USERNAME = os.getenv("WINPLATE_GITHUB_USERNAME", "kibuouo")
GITHUB_CACHE_SECONDS = 300
GITHUB_TIMEOUT_SECONDS = 4
_github_cache: tuple[float, dict] | None = None
_github_cache_lock = threading.Lock()
QWEATHER_LOCATION = os.getenv("QWEATHER_LOCATION", "").strip()
QWEATHER_CACHE_SECONDS = 600
QWEATHER_MONTHLY_LIMIT = 50000
_weather_cache: dict[str, tuple[float, dict]] = {}
_weather_cache_lock = threading.Lock()
GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
GMAIL_QUERY = "in:inbox newer_than:30d -in:spam -in:trash"
GMAIL_MAX_RESULTS = 20
GMAIL_CANDIDATE_RESULTS = 50
GMAIL_OAUTH_REDIRECT_URI = "http://127.0.0.1:8765/api/mail/oauth/callback"
GMAIL_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1"
GMAIL_TOKEN_REFRESH_SKEW_SECONDS = 60


def build_log_config() -> dict:
    config = deepcopy(LOGGING_CONFIG)
    config["formatters"]["default"]["fmt"] = "%(asctime)s %(levelprefix)s %(message)s"
    config["formatters"]["access"]["fmt"] = (
        '%(asctime)s %(levelprefix)s %(client_addr)s - "%(request_line)s" %(status_code)s'
    )
    for formatter in config["formatters"].values():
        formatter["datefmt"] = "%Y-%m-%d %H:%M:%S"
    return config


LOG_CONFIG = build_log_config()


DEFAULT_STATUS = {
    "codex": {
        "source": "mock",
        "remainingPct": 69,
        "usedPct": 31,
        "resetText": "15:23",
        "windowHours": 5,
        "status": "Normal",
    },
    "heart": {
        "heartRate": 82,
        "unit": "bpm",
        "source": "Apple Watch",
        "updatedAt": "just now",
    },
    "weather": {
        "source": "unconfigured",
        "icon": "101",
        "temperature": "--",
        "condition": "请配置天气位置",
        "location": QWEATHER_LOCATION,
    },
}

api = FastAPI(title="WinPlate API", version="0.1.0")
api.add_middleware(
    CORSMiddleware,
    allow_origins=["null"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


class WeatherLocation(BaseModel):
    latitude: float
    longitude: float


class NotificationPayload(BaseModel):
    source: str
    title: str
    message: str | None = None
    level: str = "info"
    externalUrl: str | None = None
    createdAt: int | None = None
    id: str | None = None


def environment_setting(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value or os.name != "nt":
        return value or default
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            registry_value, _ = winreg.QueryValueEx(key, name)
            return registry_value if isinstance(registry_value, str) and registry_value else default
    except (ImportError, FileNotFoundError, OSError):
        return default


def utc_epoch_seconds() -> int:
    return int(time.time())


def gmail_client_config() -> tuple[str | None, str | None]:
    return (
        environment_setting("GMAIL_CLIENT_ID"),
        environment_setting("GMAIL_CLIENT_SECRET"),
    )


def gmail_configured() -> bool:
    client_id, client_secret = gmail_client_config()
    return bool(client_id and client_secret)


def save_gmail_oauth_state(state: str, now: int | None = None) -> None:
    current = now or utc_epoch_seconds()
    with closing(connect()) as connection:
        connection.execute(
            "DELETE FROM gmail_oauth_states WHERE created_at < ?",
            (current - 600,),
        )
        connection.execute(
            "INSERT OR REPLACE INTO gmail_oauth_states (state, created_at) VALUES (?, ?)",
            (state, current),
        )
        connection.commit()


def consume_gmail_oauth_state(state: str, now: int | None = None) -> bool:
    current = now or utc_epoch_seconds()
    with closing(connect()) as connection:
        row = connection.execute(
            "SELECT created_at FROM gmail_oauth_states WHERE state = ?",
            (state,),
        ).fetchone()
        connection.execute("DELETE FROM gmail_oauth_states WHERE state = ?", (state,))
        connection.execute(
            "DELETE FROM gmail_oauth_states WHERE created_at < ?",
            (current - 600,),
        )
        connection.commit()
    return bool(row and current - int(row["created_at"]) <= 600)


def build_gmail_authorization_url(state: str) -> str:
    client_id, _client_secret = gmail_client_config()
    if not client_id:
        raise RuntimeError("GMAIL_CLIENT_ID is not configured")
    params = {
        "client_id": client_id,
        "redirect_uri": GMAIL_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": GMAIL_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
        "include_granted_scopes": "true",
    }
    return f"{GMAIL_AUTH_URL}?{urlencode(params)}"


def json_request(url: str, data: dict[str, str] | None = None, headers: dict[str, str] | None = None, timeout: int = 10) -> dict:
    encoded_data = urlencode(data).encode("utf-8") if data is not None else None
    request_headers = {"Accept": "application/json", **(headers or {})}
    if data is not None:
        request_headers["Content-Type"] = "application/x-www-form-urlencoded"
    request = Request(url, data=encoded_data, headers=request_headers)
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        try:
            payload = json.loads(error.read().decode("utf-8"))
            detail = payload.get("error_description") or payload.get("error") or f"HTTP {error.code}"
        except (UnicodeDecodeError, json.JSONDecodeError):
            detail = f"HTTP {error.code}"
        raise RuntimeError(str(detail)) from error
    except (URLError, TimeoutError) as error:
        raise RuntimeError(f"Network unavailable: {error}") from error
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("Remote API returned an invalid JSON response") from error
    if not isinstance(payload, dict):
        raise RuntimeError("Remote API returned an invalid response")
    return payload


def exchange_gmail_code(code: str) -> dict:
    client_id, client_secret = gmail_client_config()
    if not client_id or not client_secret:
        raise RuntimeError("Gmail OAuth client is not configured")
    payload = json_request(
        GMAIL_TOKEN_URL,
        {
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": GMAIL_OAUTH_REDIRECT_URI,
            "grant_type": "authorization_code",
        },
    )
    if not payload.get("access_token"):
        raise RuntimeError("OAuth token response did not include an access token")
    return payload


def save_gmail_token(payload: dict, now: int | None = None) -> None:
    current = now or utc_epoch_seconds()
    expires_in = int(payload.get("expires_in") or 3600)
    with closing(connect()) as connection:
        existing = connection.execute(
            "SELECT refresh_token FROM gmail_oauth_tokens WHERE account = 'me'"
        ).fetchone()
        refresh_token = payload.get("refresh_token") or (existing["refresh_token"] if existing else None)
        connection.execute(
            """
            INSERT INTO gmail_oauth_tokens (account, access_token, refresh_token, expires_at, scope, updated_at)
            VALUES ('me', ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(account) DO UPDATE SET
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                expires_at = excluded.expires_at,
                scope = excluded.scope,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                str(payload["access_token"]),
                refresh_token,
                current + expires_in,
                str(payload.get("scope") or GMAIL_SCOPE),
            ),
        )
        connection.commit()


def read_gmail_token() -> dict | None:
    with closing(connect()) as connection:
        row = connection.execute(
            "SELECT access_token, refresh_token, expires_at, scope, updated_at FROM gmail_oauth_tokens WHERE account = 'me'"
        ).fetchone()
    return dict(row) if row else None


def refresh_gmail_access_token(refresh_token: str) -> dict:
    client_id, client_secret = gmail_client_config()
    if not client_id or not client_secret:
        raise RuntimeError("Gmail OAuth client is not configured")
    payload = json_request(
        GMAIL_TOKEN_URL,
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
    )
    payload["refresh_token"] = refresh_token
    return payload


def gmail_access_token() -> str:
    token = read_gmail_token()
    if not token:
        raise RuntimeError("Gmail is not connected")
    if int(token["expires_at"]) - GMAIL_TOKEN_REFRESH_SKEW_SECONDS <= utc_epoch_seconds():
        refresh_token = token.get("refresh_token")
        if not refresh_token:
            raise RuntimeError("Gmail refresh token is unavailable; reconnect Gmail")
        payload = refresh_gmail_access_token(str(refresh_token))
        save_gmail_token(payload)
        token = read_gmail_token()
    if not token:
        raise RuntimeError("Gmail token is unavailable")
    return str(token["access_token"])


def gmail_api_get(path: str, params: dict[str, str | int] | None = None) -> dict:
    token = gmail_access_token()
    query = f"?{urlencode(params or {})}" if params else ""
    return json_request(
        f"{GMAIL_API_URL}{path}{query}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=12,
    )


def gmail_settings() -> dict:
    token = read_gmail_token()
    return {
        "configured": gmail_configured(),
        "connected": bool(token),
        "scope": token.get("scope") if token else GMAIL_SCOPE,
        "query": GMAIL_QUERY,
        "windowDays": 30,
        "updatedAt": token.get("updated_at") if token else None,
    }


def gmail_oauth_start() -> dict:
    if not gmail_configured():
        raise RuntimeError("请先配置 GMAIL_CLIENT_ID 和 GMAIL_CLIENT_SECRET")
    state = secrets.token_urlsafe(24)
    save_gmail_oauth_state(state)
    return {"authorizationUrl": build_gmail_authorization_url(state)}


def gmail_oauth_callback_html(code: str | None, state: str | None, error: str | None = None) -> str:
    if error:
        title = "Gmail 连接失败"
        message = error
    else:
        try:
            if not code or not state or not consume_gmail_oauth_state(state):
                raise RuntimeError("OAuth state 无效或已过期，请回到 WinPlate 重新连接")
            save_gmail_token(exchange_gmail_code(code))
            title = "Gmail 已连接"
            message = "你可以关闭这个页面并回到 WinPlate 刷新 Mail 板块。"
        except RuntimeError as oauth_error:
            title = "Gmail 连接失败"
            message = str(oauth_error)
    return f"""<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8"><title>{escape(title)}</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 32px;">
    <h1>{escape(title)}</h1>
    <p>{escape(message)}</p>
  </body>
</html>"""


def header_value(headers: list[dict], name: str, default: str = "") -> str:
    for header in headers:
        if str(header.get("name", "")).lower() == name.lower():
            return str(header.get("value") or default)
    return default


def decode_gmail_body(data: str | None) -> str:
    if not data:
        return ""
    try:
        return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", "replace")
    except (ValueError, UnicodeDecodeError):
        return ""


def first_text_part(payload: dict | None) -> str:
    if not isinstance(payload, dict):
        return ""
    mime_type = payload.get("mimeType")
    if mime_type in {"text/plain", "text/html"}:
        return decode_gmail_body(payload.get("body", {}).get("data"))
    for part in payload.get("parts") or []:
        text = first_text_part(part)
        if text:
            return text
    return ""


def clean_mail_text(value: str, limit: int = 220) -> str:
    text = unescape(re.sub(r"<[^>]+>", " ", value or ""))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit].rstrip()


def classify_mail_action(subject: str, snippet: str, label_ids: list[str]) -> str:
    text = f"{subject} {snippet}".lower()
    if "UNREAD" in label_ids:
        return "查看"
    if re.search(r"\b(action required|please reply|respond|confirm|approval|deadline|due)\b", text):
        return "需处理"
    if re.search(r"\b(invoice|receipt|statement|security alert|verification)\b", text):
        return "检查"
    return "归档参考"


def parse_gmail_message(message: dict) -> dict:
    payload = message.get("payload") if isinstance(message, dict) else {}
    headers = payload.get("headers", []) if isinstance(payload, dict) else []
    label_ids = [str(label) for label in message.get("labelIds", [])] if isinstance(message, dict) else []
    snippet = clean_mail_text(str(message.get("snippet") or ""))
    body_text = clean_mail_text(first_text_part(payload), limit=220)
    summary_source = snippet or body_text
    summary = summary_source if summary_source else "暂无可用摘要"
    subject = clean_mail_text(header_value(headers, "Subject", "(无主题)"), limit=160) or "(无主题)"
    sender = clean_mail_text(header_value(headers, "From", "Unknown sender"), limit=160) or "Unknown sender"
    try:
        sent_at = int(message.get("internalDate") or 0)
    except (TypeError, ValueError):
        sent_at = 0
    return {
        "messageId": str(message.get("id") or ""),
        "threadId": str(message.get("threadId") or ""),
        "sender": sender,
        "subject": subject,
        "sentAt": sent_at,
        "snippet": snippet,
        "summary": summary,
        "action": classify_mail_action(subject, summary, label_ids),
        "labels": label_ids,
    }


def persist_mail_outline(items: list[dict]) -> None:
    now = utc_epoch_seconds() * 1000
    with closing(connect()) as connection:
        connection.execute("DELETE FROM mail_outline_cache")
        connection.executemany(
            """
            INSERT OR REPLACE INTO mail_outline_cache
            (message_id, thread_id, sender, subject, sent_at, snippet, summary, action, labels, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    item["messageId"],
                    item["threadId"],
                    item["sender"],
                    item["subject"],
                    int(item["sentAt"]),
                    item["snippet"],
                    item["summary"],
                    item["action"],
                    json.dumps(item["labels"]),
                    now,
                )
                for item in items
                if item.get("messageId")
            ],
        )
        connection.commit()


def normalize_notification_source(source: str) -> str:
    value = re.sub(r"[^a-z0-9_-]+", "-", str(source or "").strip().lower()).strip("-")
    return value[:32] or "external"


def normalize_notification_level(level: str) -> str:
    value = str(level or "info").strip().lower()
    return value if value in {"info", "success", "warning", "critical"} else "info"


def notification_row_to_item(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "source": row["source"],
        "level": row["level"],
        "title": row["title"],
        "message": row["message"] or "",
        "unread": bool(row["unread"]),
        "createdAt": int(row["created_at"]),
        "updatedAt": int(row["updated_at"]),
        "externalUrl": row["external_url"] or None,
    }


def upsert_notification(
    *,
    notification_id: str,
    source: str,
    title: str,
    message: str = "",
    level: str = "info",
    created_at: int | None = None,
    external_url: str | None = None,
) -> dict:
    normalized_source = normalize_notification_source(source)
    safe_title = clean_mail_text(title, limit=180) or "WinPlate 通知"
    safe_message = clean_mail_text(message, limit=360)
    safe_level = normalize_notification_level(level)
    now = utc_epoch_seconds() * 1000
    created = int(created_at or now)
    with closing(connect()) as connection:
        connection.execute(
            """
            INSERT INTO notifications
            (id, source, level, title, message, unread, created_at, updated_at, external_url)
            VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                source = excluded.source,
                level = excluded.level,
                title = excluded.title,
                message = excluded.message,
                updated_at = excluded.updated_at,
                external_url = excluded.external_url
            """,
            (
                notification_id,
                normalized_source,
                safe_level,
                safe_title,
                safe_message,
                created,
                now,
                external_url,
            ),
        )
        row = connection.execute(
            """
            SELECT id, source, level, title, message, unread, created_at, updated_at, external_url
            FROM notifications
            WHERE id = ?
            """,
            (notification_id,),
        ).fetchone()
        connection.commit()
    return notification_row_to_item(row)


def sync_mail_notifications(items: list[dict]) -> None:
    for item in items:
        message_id = item.get("messageId")
        if not message_id:
            continue
        upsert_notification(
            notification_id=f"mail:{message_id}",
            source="mail",
            level="info",
            title=f"新邮件：{item.get('subject') or '(无主题)'}",
            message=str(item.get("sender") or item.get("summary") or ""),
            created_at=int(item.get("sentAt") or 0) or None,
            external_url=(
                f"https://mail.google.com/mail/u/0/#inbox/{item.get('threadId')}"
                if item.get("threadId") else None
            ),
        )


def notification_summary(limit: int = 20) -> dict:
    safe_limit = max(1, min(50, int(limit or 20)))
    with closing(connect()) as connection:
        rows = connection.execute(
            """
            SELECT id, source, level, title, message, unread, created_at, updated_at, external_url
            FROM notifications
            ORDER BY unread DESC, created_at DESC, updated_at DESC
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()
        unread_count = connection.execute(
            "SELECT COUNT(*) AS count FROM notifications WHERE unread = 1"
        ).fetchone()["count"]
    items = [notification_row_to_item(row) for row in rows]
    latest = next((item for item in items if item["unread"]), items[0] if items else None)
    return {
        "items": items,
        "latest": latest,
        "unreadCount": int(unread_count),
        "updatedAt": utc_epoch_seconds() * 1000,
    }


def mark_notification_read(notification_id: str) -> dict:
    with closing(connect()) as connection:
        connection.execute(
            "UPDATE notifications SET unread = 0, updated_at = ? WHERE id = ?",
            (utc_epoch_seconds() * 1000, notification_id),
        )
        connection.commit()
    return notification_summary()


def mark_all_notifications_read() -> dict:
    with closing(connect()) as connection:
        connection.execute(
            "UPDATE notifications SET unread = 0, updated_at = ? WHERE unread = 1",
            (utc_epoch_seconds() * 1000,),
        )
        connection.commit()
    return notification_summary()


def push_notification(payload: NotificationPayload) -> dict:
    source = normalize_notification_source(payload.source)
    now = utc_epoch_seconds() * 1000
    notification_id = payload.id or f"{source}:{now}"
    return upsert_notification(
        notification_id=notification_id,
        source=source,
        title=payload.title,
        message=payload.message or "",
        level=payload.level,
        created_at=payload.createdAt,
        external_url=payload.externalUrl,
    )


def cached_mail_outline() -> list[dict]:
    with closing(connect()) as connection:
        rows = connection.execute(
            """
            SELECT message_id, thread_id, sender, subject, sent_at, snippet, summary, action, labels, updated_at
            FROM mail_outline_cache
            ORDER BY sent_at DESC
            LIMIT ?
            """,
            (GMAIL_MAX_RESULTS,),
        ).fetchall()
    items = []
    for row in rows:
        try:
            labels = json.loads(row["labels"])
        except (TypeError, json.JSONDecodeError):
            labels = []
        items.append({
            "messageId": row["message_id"],
            "threadId": row["thread_id"],
            "sender": row["sender"],
            "subject": row["subject"],
            "sentAt": int(row["sent_at"]),
            "snippet": row["snippet"],
            "summary": row["summary"],
            "action": row["action"],
            "labels": labels if isinstance(labels, list) else [],
            "cachedAt": int(row["updated_at"]),
        })
    return items


def read_mail_outline_from_gmail() -> list[dict]:
    messages_payload = gmail_api_get(
        "/users/me/messages",
        {"q": GMAIL_QUERY, "maxResults": GMAIL_CANDIDATE_RESULTS},
    )
    candidates = messages_payload.get("messages") or []
    outlines = []
    seen_threads = set()
    for candidate in candidates:
        message_id = candidate.get("id") if isinstance(candidate, dict) else None
        if not message_id:
            continue
        message = gmail_api_get(
            f"/users/me/messages/{quote(str(message_id), safe='')}",
            {
                "format": "full",
                "metadataHeaders": "From",
            },
        )
        outline = parse_gmail_message(message)
        thread_id = outline["threadId"]
        if thread_id and thread_id in seen_threads:
            continue
        if thread_id:
            seen_threads.add(thread_id)
        outlines.append(outline)
        if len(outlines) >= GMAIL_MAX_RESULTS:
            break
    outlines.sort(key=lambda item: item.get("sentAt", 0), reverse=True)
    return outlines


def mail_outline(force: bool = False) -> dict:
    if not gmail_configured():
        return {
            "source": "unconfigured",
            "availability": "unconfigured",
            "query": GMAIL_QUERY,
            "windowDays": 30,
            "items": cached_mail_outline(),
            "updatedAt": None,
            "error": "Gmail OAuth client is not configured",
        }
    if not read_gmail_token():
        return {
            "source": "unconnected",
            "availability": "unconnected",
            "query": GMAIL_QUERY,
            "windowDays": 30,
            "items": cached_mail_outline(),
            "updatedAt": None,
        }
    try:
        items = read_mail_outline_from_gmail()
        persist_mail_outline(items)
        sync_mail_notifications(items)
        return {
            "source": "gmail",
            "availability": "live",
            "query": GMAIL_QUERY,
            "windowDays": 30,
            "items": items,
            "updatedAt": utc_epoch_seconds() * 1000,
        }
    except RuntimeError as error:
        cached = cached_mail_outline()
        return {
            "source": "gmail-cache" if cached else "unavailable",
            "availability": "cached" if cached else "unavailable",
            "query": GMAIL_QUERY,
            "windowDays": 30,
            "items": cached,
            "updatedAt": max((item.get("cachedAt", 0) for item in cached), default=None),
            "error": str(error),
        }

def github_token() -> str | None:
    return environment_setting("GITHUB_TOKEN")


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database() -> None:
    with closing(connect()) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS status_modules (
                module TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS qweather_usage (
                month TEXT PRIMARY KEY,
                request_count INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS qweather_usage_daily (
                day TEXT PRIMARY KEY,
                request_count INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS gmail_oauth_tokens (
                account TEXT PRIMARY KEY,
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                expires_at INTEGER NOT NULL,
                scope TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS gmail_oauth_states (
                state TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                level TEXT NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL DEFAULT '',
                unread INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                external_url TEXT
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_notifications_unread_created ON notifications (unread, created_at)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS mail_outline_cache (
                message_id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                sender TEXT NOT NULL,
                subject TEXT NOT NULL,
                sent_at INTEGER NOT NULL,
                snippet TEXT NOT NULL,
                summary TEXT NOT NULL,
                action TEXT NOT NULL,
                labels TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )
        for module, payload in DEFAULT_STATUS.items():
            initial_payload = deepcopy(payload)
            connection.execute(
                "INSERT OR IGNORE INTO status_modules (module, payload) VALUES (?, ?)",
                (module, json.dumps(initial_payload)),
            )
        connection.commit()


def github_request(path: str) -> object:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "WinPlate",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = github_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = Request(f"{GITHUB_API_URL}{path}", headers=headers)
    try:
        with urlopen(request, timeout=GITHUB_TIMEOUT_SECONDS) as response:
            return json.load(response)
    except HTTPError as error:
        if error.code == 401:
            raise RuntimeError("auth: GitHub authentication was rejected") from error
        if error.code == 403:
            raise RuntimeError("rate-limit: GitHub API rate limit reached") from error
        if error.code == 429:
            raise RuntimeError("rate-limit: GitHub API is temporarily rate-limited") from error
        raise RuntimeError(f"unavailable: GitHub API returned HTTP {error.code}") from error
    except (URLError, TimeoutError) as error:
        reason = "slow" if isinstance(error, TimeoutError) or "timed out" in str(error).lower() else "unavailable"
        raise RuntimeError(f"{reason}: GitHub API unavailable") from error


def github_graphql_request(query: str, variables: dict[str, object]) -> dict:
    token = github_token()
    if not token:
        raise RuntimeError("auth: GitHub token is required for GraphQL requests")

    request = Request(
        "https://api.github.com/graphql",
        data=json.dumps({"query": query, "variables": variables}).encode("utf-8"),
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "WinPlate",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urlopen(request, timeout=GITHUB_TIMEOUT_SECONDS) as response:
            payload = json.load(response)
    except HTTPError as error:
        if error.code == 401:
            raise RuntimeError("auth: GitHub authentication was rejected") from error
        if error.code == 403:
            raise RuntimeError("rate-limit: GitHub API rate limit reached") from error
        if error.code == 429:
            raise RuntimeError("rate-limit: GitHub API is temporarily rate-limited") from error
        raise RuntimeError(f"unavailable: GitHub API returned HTTP {error.code}") from error
    except (URLError, TimeoutError) as error:
        reason = "slow" if isinstance(error, TimeoutError) or "timed out" in str(error).lower() else "unavailable"
        raise RuntimeError(f"{reason}: GitHub API unavailable") from error

    if not isinstance(payload, dict):
        raise RuntimeError("unavailable: GitHub API returned an invalid response")
    errors = payload.get("errors")
    if errors:
        message = errors[0].get("message", "GitHub GraphQL query failed") if isinstance(errors, list) else "GitHub GraphQL query failed"
        raise RuntimeError(f"unavailable: {message}")
    return payload


def github_public_page(path: str) -> str:
    request = Request(
        f"https://github.com{path}",
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": "WinPlate",
        },
    )
    try:
        with urlopen(request, timeout=GITHUB_TIMEOUT_SECONDS) as response:
            return response.read().decode("utf-8", "replace")
    except HTTPError as error:
        if error.code == 404:
            raise RuntimeError("unavailable: GitHub profile was not found") from error
        if error.code == 429:
            raise RuntimeError("rate-limit: GitHub is temporarily rate-limited") from error
        raise RuntimeError(f"unavailable: GitHub returned HTTP {error.code}") from error
    except (URLError, TimeoutError) as error:
        reason = "slow" if isinstance(error, TimeoutError) or "timed out" in str(error).lower() else "unavailable"
        raise RuntimeError(f"{reason}: GitHub unavailable") from error


def qweather_request(path: str, params: dict[str, str]) -> dict:
    api_key = environment_setting("QWEATHER_API_KEY")
    api_host = environment_setting("QWEATHER_API_HOST", "devapi.qweather.com")
    if not api_key:
        raise RuntimeError("QWEATHER_API_KEY is not configured")
    request = Request(
        f"https://{api_host}{path}?{urlencode(params)}",
        headers={
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "User-Agent": "WinPlate",
            "X-QW-Api-Key": api_key,
        },
    )
    record_qweather_request()
    try:
        with urlopen(request, timeout=10) as response:
            body = response.read()
            if response.headers.get("Content-Encoding", "").lower() == "gzip" or body.startswith(b"\x1f\x8b"):
                body = gzip.decompress(body)
            payload = json.loads(body.decode("utf-8"))
    except HTTPError as error:
        raise RuntimeError(f"QWeather API returned HTTP {error.code}") from error
    except (URLError, TimeoutError) as error:
        raise RuntimeError(f"QWeather API unavailable: {error}") from error
    except (gzip.BadGzipFile, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"QWeather API returned an invalid response: {error}") from error
    if not isinstance(payload, dict) or payload.get("code") != "200":
        code = payload.get("code", "invalid response") if isinstance(payload, dict) else "invalid response"
        raise RuntimeError(f"QWeather API returned code {code}")
    return payload


def record_qweather_request(now: datetime | None = None) -> None:
    current = now or datetime.now().astimezone()
    month = current.strftime("%Y-%m")
    day = current.strftime("%Y-%m-%d")
    with closing(connect()) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS qweather_usage (
                month TEXT PRIMARY KEY,
                request_count INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        connection.execute(
            """
            INSERT INTO qweather_usage (month, request_count) VALUES (?, 1)
            ON CONFLICT(month) DO UPDATE SET request_count = request_count + 1
            """,
            (month,),
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS qweather_usage_daily (
                day TEXT PRIMARY KEY,
                request_count INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        connection.execute(
            """
            INSERT INTO qweather_usage_daily (day, request_count) VALUES (?, 1)
            ON CONFLICT(day) DO UPDATE SET request_count = request_count + 1
            """,
            (day,),
        )
        connection.commit()


def qweather_usage(now: datetime | None = None) -> dict:
    current = now or datetime.now().astimezone()
    month = current.strftime("%Y-%m")
    day = current.strftime("%Y-%m-%d")
    with closing(connect()) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS qweather_usage (
                month TEXT PRIMARY KEY,
                request_count INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        row = connection.execute(
            "SELECT request_count FROM qweather_usage WHERE month = ?",
            (month,),
        ).fetchone()
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS qweather_usage_daily (
                day TEXT PRIMARY KEY,
                request_count INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        daily_row = connection.execute(
            "SELECT request_count FROM qweather_usage_daily WHERE day = ?",
            (day,),
        ).fetchone()
    used = int(row["request_count"]) if row else 0
    remaining = max(0, QWEATHER_MONTHLY_LIMIT - used)
    percent = min(100.0, round(used / QWEATHER_MONTHLY_LIMIT * 100, 1))
    return {
        "month": month,
        "used": used,
        "total": QWEATHER_MONTHLY_LIMIT,
        "remaining": remaining,
        "percent": percent,
        "today": int(daily_row["request_count"]) if daily_row else 0,
    }


def _sum_metric_hours(value: object) -> int:
    if isinstance(value, dict):
        if isinstance(value.get("hours"), list):
            return sum(int(item or 0) for item in value["hours"])
        return sum(_sum_metric_hours(item) for item in value.values())
    if isinstance(value, list):
        return sum(_sum_metric_hours(item) for item in value)
    return 0


def _sum_named_metric(value: object, name: str) -> int:
    if isinstance(value, dict):
        total = _sum_metric_hours(value.get(name, {}))
        return total + sum(
            _sum_named_metric(item, name)
            for key, item in value.items()
            if key != name
        )
    if isinstance(value, list):
        return sum(_sum_named_metric(item, name) for item in value)
    return 0


def _decode_qweather_json(body: bytes, content_encoding: str = "") -> dict:
    if content_encoding.lower() == "gzip" or body.startswith(b"\x1f\x8b"):
        body = gzip.decompress(body)
    payload = json.loads(body.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("QWeather response is not an object")
    return payload


def qweather_jwt_request(path: str, params: dict[str, str] | None = None, timeout: int = 10) -> dict:
    project_id = environment_setting("QWEATHER_PROJECT_ID")
    credential_id = environment_setting("QWEATHER_CREDENTIAL_ID")
    private_key = environment_setting("QWEATHER_PRIVATE_KEY")
    api_host = environment_setting("QWEATHER_API_HOST", "devapi.qweather.com")
    if not project_id or not credential_id or not private_key:
        raise RuntimeError("QWeather JWT 项目 ID、凭据 ID 或私钥尚未配置")

    now = int(time.time())
    token = jwt.encode(
        {"sub": project_id, "iat": now - 30, "exp": now + 900},
        private_key.replace("\\n", "\n"),
        algorithm="EdDSA",
        headers={"kid": credential_id},
    )
    query = f"?{urlencode(params or {})}" if params else ""
    request = Request(
        f"https://{api_host}{path}{query}",
        headers={
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "Authorization": f"Bearer {token}",
            "User-Agent": "WinPlate",
        },
    )
    record_qweather_request()
    try:
        with urlopen(request, timeout=timeout) as response:
            return _decode_qweather_json(
                response.read(),
                getattr(response, "headers", {}).get("Content-Encoding", ""),
            )
    except HTTPError as error:
        body = error.read()
        try:
            detail = _decode_qweather_json(
                body,
                error.headers.get("Content-Encoding", ""),
            ).get("error", {}).get("detail")
        except (gzip.BadGzipFile, UnicodeDecodeError, json.JSONDecodeError, ValueError):
            detail = None
        if error.code in (401, 403):
            message = "QWeather JWT 凭据无效或权限不足"
            if detail:
                message = f"{message}: {detail}"
            raise RuntimeError(message) from error
        raise RuntimeError(f"QWeather 接口返回 HTTP {error.code}") from error
    except (URLError, TimeoutError) as error:
        raise RuntimeError(f"QWeather 接口不可用: {error}") from error
    except (gzip.BadGzipFile, UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise RuntimeError("QWeather 接口返回了无效响应") from error


def qweather_official_stats() -> dict:
    credential_id = environment_setting("QWEATHER_CREDENTIAL_ID")
    payload = qweather_jwt_request("/metrics/v1/stats", {"credential": credential_id})

    success = _sum_named_metric(payload, "success")
    errors = _sum_named_metric(payload, "errors")
    return {
        "total": success + errors,
        "success": success,
        "errors": errors,
        "asOf": payload.get("asOf") or payload.get("updateTime") or datetime.now(timezone.utc).isoformat(),
    }


def build_weather_status(location: str) -> dict:
    location_payload = qweather_request("/geo/v2/city/lookup", {"location": location, "number": "1", "lang": "zh"})
    matches = location_payload.get("location", [])
    if not matches:
        raise RuntimeError(f"QWeather could not find location: {location}")
    place = matches[0]
    weather_payload = qweather_request("/v7/weather/now", {"location": place["id"], "lang": "zh", "unit": "m"})
    hourly_payload = qweather_request("/v7/weather/24h", {"location": place["id"], "lang": "zh", "unit": "m"})
    daily_payload = qweather_request("/v7/weather/3d", {"location": place["id"], "lang": "zh", "unit": "m"})
    now = weather_payload.get("now")
    if not isinstance(now, dict):
        raise RuntimeError("QWeather current weather response is missing 'now'")
    temperature = int(float(now["temp"]))
    feels_like = int(float(now["feelsLike"]))
    icon = str(now.get("icon", "999"))
    humidity = int(now["humidity"])
    precipitation = float(now["precip"])
    pressure = int(now["pressure"])
    visibility = int(float(now["vis"]))
    hourly = hourly_payload.get("hourly", [])
    daily = daily_payload.get("daily", [])
    precipitation_probability = None
    if hourly and isinstance(hourly[0], dict) and str(hourly[0].get("pop", "")).isdigit():
        precipitation_probability = int(hourly[0]["pop"])
    today = daily[0] if daily and isinstance(daily[0], dict) else {}
    day_condition = str(today.get("textDay", "")).strip()
    night_condition = str(today.get("textNight", "")).strip()
    weather_summary_parts = []
    if day_condition and night_condition:
        weather_summary_parts.append(f"今天白天{day_condition}，夜晚{night_condition}")
    elif day_condition:
        weather_summary_parts.append(f"今天白天{day_condition}")
    elif night_condition:
        weather_summary_parts.append(f"今天夜晚{night_condition}")
    weather_summary_parts.append(f"现在{temperature}°")
    weather_summary = "，".join(weather_summary_parts) + "。"
    place_name = place.get("name", location)
    admin = place.get("adm1")
    forecast = [
        {
            "date": item.get("fxDate", ""),
            "icon": str(item.get("iconDay", "999")),
            "condition": item.get("textDay", "未知"),
            "tempMax": int(float(item["tempMax"])),
            "tempMin": int(float(item["tempMin"])),
            "precipitationProbability": int(item["precip"]) if str(item.get("precip", "")).isdigit() else None,
        }
        for item in daily[:3]
        if isinstance(item, dict) and item.get("tempMax") is not None and item.get("tempMin") is not None
    ]
    return {
        "source": "qweather",
        "icon": icon,
        "temperature": temperature,
        "feelsLike": feels_like,
        "condition": now.get("text", "未知"),
        "location": f"{place_name}, {admin}" if admin and admin != place_name else place_name,
        "humidity": humidity,
        "precipitation": precipitation,
        "pressure": pressure,
        "visibility": visibility,
        "precipitationProbability": precipitation_probability,
        "weatherSummary": weather_summary,
        "forecast": forecast,
        "windDirection": now.get("windDir", ""),
        "windScale": now.get("windScale", ""),
        "observedAt": now.get("obsTime", ""),
        "updatedAt": weather_payload.get("updateTime", ""),
    }


def weather_status(location: str | None = None, force: bool = False) -> dict:
    query = location or QWEATHER_LOCATION
    if not query:
        return deepcopy(DEFAULT_STATUS["weather"])
    now = time.monotonic()
    with _weather_cache_lock:
        cached = _weather_cache.get(query)
    if not force and cached and now - cached[0] < QWEATHER_CACHE_SECONDS:
        return cached[1]
    data = build_weather_status(query)
    with _weather_cache_lock:
        _weather_cache[query] = (now, data)
    return data


def persist_weather_location(latitude: float, longitude: float) -> None:
    payload = {
        "latitude": latitude,
        "longitude": longitude,
        "query": f"{longitude:.6f},{latitude:.6f}",
        "updatedAt": utc_epoch_seconds() * 1000,
    }
    with closing(connect()) as connection:
        connection.execute(
            """
            INSERT INTO status_modules (module, payload, updated_at)
            VALUES ('weather_location', ?, CURRENT_TIMESTAMP)
            ON CONFLICT(module) DO UPDATE SET
                payload = excluded.payload,
                updated_at = CURRENT_TIMESTAMP
            """,
            (json.dumps(payload),),
        )
        connection.commit()


def read_weather_location() -> dict | None:
    with closing(connect()) as connection:
        row = connection.execute(
            "SELECT payload FROM status_modules WHERE module = 'weather_location'"
        ).fetchone()
    if not row:
        return None
    try:
        payload = json.loads(row["payload"])
    except (TypeError, json.JSONDecodeError):
        return None
    latitude = payload.get("latitude")
    longitude = payload.get("longitude")
    if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
        return None
    return {"latitude": float(latitude), "longitude": float(longitude)}


def qweather_alerts(latitude: float | None = None, longitude: float | None = None) -> dict:
    location = {"latitude": latitude, "longitude": longitude}
    if latitude is None or longitude is None:
        stored = read_weather_location()
        if not stored:
            return {"source": "qweather", "alerts": [], "updatedAt": None, "error": "天气预警需要先获取一次定位"}
        location = stored
    lat = float(location["latitude"])
    lon = float(location["longitude"])
    if not -90 <= lat <= 90 or not -180 <= lon <= 180:
        raise RuntimeError("Invalid weather alert coordinates")
    payload = qweather_jwt_request(f"/weatheralert/v1/current/{lat:.2f}/{lon:.2f}", None)
    alerts = payload.get("alerts") if isinstance(payload, dict) else []
    if not isinstance(alerts, list):
        alerts = []
    normalized = []
    for alert in alerts:
        if not isinstance(alert, dict):
            continue
        alert_id = str(alert.get("id") or alert.get("alertId") or alert.get("identifier") or "")
        title = clean_mail_text(str(alert.get("headline") or alert.get("title") or "天气预警"), limit=180)
        message = clean_mail_text(str(alert.get("description") or alert.get("text") or ""), limit=360)
        severity = str(alert.get("severity") or alert.get("color") or "warning").lower()
        level = "critical" if severity in {"red", "extreme", "severe"} else "warning"
        created_at = None
        for key in ("issuedTime", "effectiveTime", "onset", "startTime"):
            value = alert.get(key)
            if value:
                try:
                    created_at = int(datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp() * 1000)
                    break
                except ValueError:
                    pass
        normalized_alert = {
            "id": alert_id,
            "title": title,
            "message": message,
            "level": level,
            "severity": severity,
            "createdAt": created_at,
        }
        normalized.append(normalized_alert)
        if alert_id:
            upsert_notification(
                notification_id=f"qweather:{alert_id}",
                source="qweather",
                level=level,
                title=title,
                message=message,
                created_at=created_at,
            )
    return {
        "source": "qweather",
        "alerts": normalized,
        "updatedAt": utc_epoch_seconds() * 1000,
    }


def contribution_level(count: int) -> int:
    if count <= 0:
        return 0
    if count == 1:
        return 1
    if count <= 3:
        return 2
    if count <= 6:
        return 3
    return 4


def month_key(value: datetime) -> str:
    return value.strftime("%Y-%m")


def previous_month(year: int, month: int) -> tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


def contribution_window_start(now: datetime) -> datetime:
    year, month = now.year, now.month
    for _ in range(11):
        year, month = previous_month(year, month)
    return datetime(year, month, 1, tzinfo=timezone.utc)


def github_contribution_days(username: str, now: datetime | None = None) -> dict[str, int]:
    current = now or datetime.now(timezone.utc)
    try:
        days = github_contribution_days_via_graphql(username, current)
        if days:
            return days
    except RuntimeError:
        pass
    return github_contribution_days_via_public_page(username, current)


def github_contribution_days_via_graphql(username: str, now: datetime) -> dict[str, int]:
    if not github_token():
        return {}

    query = """
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
    """
    from_date = contribution_window_start(now).date().isoformat() + "T00:00:00Z"
    to_date = now.date().isoformat() + "T23:59:59Z"
    payload = github_graphql_request(query, {"login": username, "from": from_date, "to": to_date})
    user = payload.get("data", {}).get("user") if isinstance(payload, dict) else None
    weeks = (
        user.get("contributionsCollection", {})
        .get("contributionCalendar", {})
        .get("weeks", [])
        if isinstance(user, dict)
        else []
    )
    contribution_days: dict[str, int] = {}
    for week in weeks:
        if not isinstance(week, dict):
            continue
        for day in week.get("contributionDays", []):
            if not isinstance(day, dict):
                continue
            date = day.get("date")
            count = day.get("contributionCount")
            if isinstance(date, str) and isinstance(count, int):
                contribution_days[date] = count
    return contribution_days


def github_contribution_days_via_public_page(username: str, now: datetime) -> dict[str, int]:
    start = contribution_window_start(now).date().isoformat()
    end = now.date().isoformat()
    encoded_username = quote(username, safe="")
    html = github_public_page(f"/users/{encoded_username}/contributions?from={start}&to={end}")
    contribution_days: dict[str, int] = {}
    pattern = re.compile(
        r'data-date="(?P<date>\d{4}-\d{2}-\d{2})"[^>]*></td>\s*'
        r'<tool-tip[^>]*>(?P<label>.*?)</tool-tip>',
        re.DOTALL,
    )
    for match in pattern.finditer(html):
        date = match.group("date")
        label = unescape(re.sub(r"\s+", " ", match.group("label"))).strip()
        count_match = re.search(r"(\d+)\s+contributions?\s+on", label)
        contribution_days[date] = int(count_match.group(1)) if count_match else 0
    return contribution_days


def build_github_status(username: str) -> dict:
    encoded_username = quote(username, safe="")
    paths = {
        "profile": f"/users/{encoded_username}",
        "repositories": f"/users/{encoded_username}/repos?sort=pushed&direction=desc&per_page=100",
    }
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {key: executor.submit(github_request, path) for key, path in paths.items()}
        futures["contributions"] = executor.submit(github_contribution_days, username)
        profile = futures["profile"].result()
        repositories = futures["repositories"].result()
        contribution_days = futures["contributions"].result()

    if not isinstance(profile, dict) or not isinstance(repositories, list) or not isinstance(contribution_days, dict):
        raise RuntimeError("GitHub API returned an unexpected response")

    now = datetime.now(timezone.utc)
    daily_counts = [0] * 30
    monthly_counts: dict[str, list[int]] = {}
    monthly_commits: dict[str, int] = {}
    year, month = now.year, now.month
    for _ in range(12):
        key = f"{year:04d}-{month:02d}"
        monthly_counts[key] = [0] * monthrange(year, month)[1]
        monthly_commits[key] = 0
        year, month = previous_month(year, month)

    for date_text, count in contribution_days.items():
        try:
            created_at = datetime.fromisoformat(date_text).replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            continue
        days_ago = (now.date() - created_at.date()).days
        if 0 <= days_ago < 30:
            daily_counts[29 - days_ago] = count
        key = month_key(created_at)
        if key in monthly_counts:
            monthly_counts[key][created_at.day - 1] = count
            monthly_commits[key] += count

    streak_days = 0
    for count in reversed(daily_counts):
        if count == 0:
            break
        streak_days += 1

    repository = repositories[0] if repositories else {}
    display_name = profile.get("name") or profile.get("login") or username
    contribution_months = [
        {
            "key": key,
            "label": datetime.strptime(key, "%Y-%m").strftime("%B %Y"),
            "commits": monthly_commits[key],
            "counts": counts,
            "levels": [contribution_level(count) for count in counts],
        }
        for key, counts in reversed(monthly_counts.items())
    ]
    current_month = contribution_months[-1]
    return {
        "source": "github",
        "name": display_name,
        "username": f"@{profile.get('login', username)}",
        "profileUrl": profile.get("html_url", f"https://github.com/{username}"),
        "avatarUrl": profile.get("avatar_url", ""),
        "repos": profile.get("public_repos", 0),
        "followers": profile.get("followers", 0),
        "project": repository.get("name", "No public repositories"),
        "commitsThisMonth": current_month["commits"],
        "streakDays": streak_days,
        "status": "Live",
        "language": repository.get("language") or "Unknown",
        "stars": repository.get("stargazers_count", 0),
        "updatedText": repository.get("pushed_at", ""),
        "contributions30d": [contribution_level(count) for count in daily_counts],
        "contributionMonth": now.strftime("%B"),
        "contributionMonths": contribution_months,
        "updatedAt": int(time.time() * 1000),
    }


def persist_github_status(data: dict) -> None:
    with closing(connect()) as connection:
        connection.execute(
            """
            INSERT INTO status_modules (module, payload, updated_at)
            VALUES ('github', ?, CURRENT_TIMESTAMP)
            ON CONFLICT(module) DO UPDATE SET
                payload = excluded.payload,
                updated_at = CURRENT_TIMESTAMP
            """,
            (json.dumps(data),),
        )
        connection.commit()


def cached_github_status() -> dict | None:
    with closing(connect()) as connection:
        row = connection.execute(
            "SELECT payload FROM status_modules WHERE module = 'github'"
        ).fetchone()
    if not row:
        return None
    try:
        data = json.loads(row["payload"])
    except (TypeError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) and data.get("source") == "github" else None


def github_failure_state(error: RuntimeError) -> tuple[str, str]:
    reason, _, _detail = str(error).partition(":")
    messages = {
        "auth": "Authentication unavailable; showing last known data.",
        "rate-limit": "GitHub rate limit reached; showing last known data.",
        "slow": "GitHub is responding slowly; showing last known data.",
        "unavailable": "GitHub is unavailable; showing last known data.",
    }
    normalized = reason if reason in messages else "unavailable"
    return normalized, messages[normalized]


def github_status(force: bool = False) -> dict:
    global _github_cache
    now = time.monotonic()
    with _github_cache_lock:
        cached = _github_cache
    if not force and cached and now - cached[0] < GITHUB_CACHE_SECONDS:
        return cached[1]
    try:
        data = build_github_status(GITHUB_USERNAME)
        persist_github_status(data)
        with _github_cache_lock:
            _github_cache = (now, data)
        return data
    except RuntimeError as error:
        reason, message = github_failure_state(error)
        cached = cached_github_status()
        if cached:
            return {
                **cached,
                "source": "github-cache",
                "status": "Cached",
                "availability": reason,
                "stateMessage": message,
            }
        return {
            "source": "unavailable",
            "name": GITHUB_USERNAME,
            "username": f"@{GITHUB_USERNAME}",
            "profileUrl": f"https://github.com/{GITHUB_USERNAME}",
            "status": "Unavailable",
            "availability": reason,
            "stateMessage": message.replace("showing last known data", "no cached data is available"),
        }


@api.on_event("startup")
def startup() -> None:
    initialize_database()


@api.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@api.get("/api/status")
def status() -> dict[str, dict]:
    with closing(connect()) as connection:
        rows = connection.execute(
            "SELECT module, payload FROM status_modules ORDER BY module"
        ).fetchall()
    result = {row["module"]: json.loads(row["payload"]) for row in rows}
    result["github"] = github_status()
    if environment_setting("QWEATHER_API_KEY"):
        if QWEATHER_LOCATION:
            try:
                result["weather"] = weather_status()
            except RuntimeError as error:
                result["weather"] = {**result.get("weather", DEFAULT_STATUS["weather"]), "source": "unavailable", "error": str(error)}
        else:
            result["weather"] = deepcopy(DEFAULT_STATUS["weather"])
    return result


@api.post("/api/github/refresh")
def refresh_github() -> dict:
    return github_status(force=True)


@api.post("/api/weather/refresh")
def refresh_weather(location: WeatherLocation | None = None) -> dict:
    try:
        query = None
        if location:
            if not -90 <= location.latitude <= 90 or not -180 <= location.longitude <= 180:
                raise HTTPException(status_code=422, detail="Invalid coordinates")
            persist_weather_location(location.latitude, location.longitude)
            query = f"{location.longitude:.6f},{location.latitude:.6f}"
        return weather_status(query, force=True)
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@api.get("/api/weather/usage")
def get_weather_usage() -> dict:
    return qweather_usage()


@api.post("/api/weather/usage/official")
def refresh_weather_official_usage() -> dict:
    try:
        return qweather_official_stats()
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@api.get("/api/weather/alerts")
def get_weather_alerts() -> dict:
    try:
        return qweather_alerts()
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@api.get("/api/mail/settings")
def get_mail_settings() -> dict:
    return gmail_settings()


@api.post("/api/mail/oauth/start")
def start_mail_oauth() -> dict:
    try:
        return gmail_oauth_start()
    except RuntimeError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@api.get("/api/mail/oauth/callback", response_class=HTMLResponse)
def mail_oauth_callback(code: str | None = None, state: str | None = None, error: str | None = None) -> str:
    return gmail_oauth_callback_html(code, state, error)


@api.get("/api/mail/outline")
def get_mail_outline() -> dict:
    return mail_outline()


@api.post("/api/mail/refresh")
def refresh_mail_outline() -> dict:
    return mail_outline(force=True)


@api.get("/api/notifications")
def get_notifications(limit: int = 20) -> dict:
    return notification_summary(limit)


@api.post("/api/notifications")
def create_notification(payload: NotificationPayload) -> dict:
    return push_notification(payload)


@api.post("/api/notifications/{notification_id}/read")
def mark_notification_as_read(notification_id: str) -> dict:
    return mark_notification_read(notification_id)


@api.post("/api/notifications/read-all")
def mark_notifications_as_read() -> dict:
    return mark_all_notifications_read()


if __name__ == "__main__":
    uvicorn.run(
        api,
        host="127.0.0.1",
        port=8765,
        use_colors=True,
        log_config=LOG_CONFIG,
    )
