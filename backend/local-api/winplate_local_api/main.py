import gzip
import imaplib
import json
import os
import re
import email.utils
import sqlite3
import sys
import threading
import time
from collections.abc import Mapping
from copy import deepcopy
from contextlib import closing
from calendar import monthrange
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email import message_from_bytes, policy
from email.header import decode_header, make_header
from email.message import Message
from html import escape, unescape
from pathlib import Path
from xml.etree import ElementTree
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import uvicorn
import jwt
from uvicorn.config import LOGGING_CONFIG
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .modules.registry import public_modules


def resolve_database_path(
    environment: Mapping[str, str] = os.environ,
    home: Path | None = None,
    platform: str = sys.platform,
) -> Path:
    explicit_directory = environment.get("WINPLATE_DATA_DIR", "").strip()
    user_home = home or Path.home()
    if explicit_directory:
        data_directory = Path(explicit_directory).expanduser()
    elif platform == "win32":
        data_directory = Path(environment.get("LOCALAPPDATA", user_home / "AppData" / "Local")) / "WinPlate"
    elif platform == "darwin":
        data_directory = user_home / "Library" / "Application Support" / "WinPlate"
    else:
        data_directory = Path(environment.get("XDG_DATA_HOME", user_home / ".local" / "share")) / "WinPlate"
    data_directory.mkdir(parents=True, exist_ok=True)
    return data_directory / "winplate.db"


DATABASE_PATH = resolve_database_path()
GITHUB_API_URL = "https://api.github.com"
DEFAULT_GITHUB_USERNAME = "kibuouo"
GITHUB_CACHE_SECONDS = 300
GITHUB_TIMEOUT_SECONDS = 4
_github_cache: tuple[float, dict] | None = None
_github_cache_lock = threading.Lock()
QWEATHER_LOCATION = os.getenv("QWEATHER_LOCATION", "").strip()
QWEATHER_CACHE_SECONDS = 600
QWEATHER_MONTHLY_LIMIT = 50000
_weather_cache: dict[str, tuple[float, dict]] = {}
_weather_cache_lock = threading.Lock()
MAIL_QUERY = "IMAP INBOX SINCE 30 days"
MAIL_WINDOW_DAYS = 30
MAIL_MAX_RESULTS = 20
MAIL_CANDIDATE_RESULTS = 50
QQ_IMAP_HOST = "imap.qq.com"
QQ_IMAP_PORT = 993
QQ_IMAP_SECURE = True
QQ_SMTP_HOST = "smtp.qq.com"
QQ_SMTP_PORT = 465
QQ_SMTP_SECURE = True
WINDOWS_FILETIME_EPOCH_MS = 11644473600000
OPENAI_NOTIFICATION_HANDLERS = {
    "OpenAI.Codex": "codex",
    "OpenAI.ChatGPT": "chatgpt",
}


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


class WeatherLocation(BaseModel):
    latitude: float
    longitude: float


class ManualWeatherLocation(BaseModel):
    locationId: str
    name: str | None = None
    adm1: str | None = None
    latitude: float | None = None
    longitude: float | None = None


class NotificationPayload(BaseModel):
    source: str
    title: str
    message: str | None = None
    level: str = "info"
    externalUrl: str | None = None
    createdAt: int | None = None
    id: str | None = None


class NotificationReadManyPayload(BaseModel):
    ids: list[str]


class NotificationDigestRecordPayload(BaseModel):
    title: str
    summary: str
    content: str | None = None
    severity: str = "info"
    category: str = "system"
    iconKey: str = "bell"
    unreadCount: int = 0
    generatedAt: int | None = None
    source: str = "deepseek"
    model: str | None = None
    sourceIds: list[str] | None = None


def environment_setting(name: str, default: str | None = None) -> str | None:
    environment_has_value = name in os.environ
    value = os.environ.get(name)
    if os.name != "nt":
        return value if environment_has_value else default
    has_truncated_private_key = (
        environment_has_value
        and name.endswith("_PRIVATE_KEY")
        and str(value or "").replace("\\n", "\n").strip().startswith("-----BEGIN ")
        and "-----END " not in str(value or "").replace("\\n", "\n").strip()
    )
    if environment_has_value and not has_truncated_private_key:
        return value
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            registry_value, _ = winreg.QueryValueEx(key, name)
            if not isinstance(registry_value, str) or not registry_value:
                return value or default
            if value and name.endswith("_PRIVATE_KEY"):
                normalized_value = value.replace("\\n", "\n").strip()
                normalized_registry = registry_value.replace("\\n", "\n").strip()
                if normalized_value.startswith("-----BEGIN ") and "-----END " not in normalized_value and "-----END " in normalized_registry:
                    return registry_value
            return registry_value or default
    except (ImportError, FileNotFoundError, OSError):
        return value if environment_has_value else default


def github_username() -> str:
    value = str(environment_setting("WINPLATE_GITHUB_USERNAME", DEFAULT_GITHUB_USERNAME) or DEFAULT_GITHUB_USERNAME).strip()
    return value if re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?", value) else DEFAULT_GITHUB_USERNAME


def utc_epoch_seconds() -> int:
    return int(time.time())


def qq_mail_config() -> dict:
    return {
        "address": environment_setting("QQ_MAIL_ADDRESS"),
        "authCode": environment_setting("QQ_MAIL_AUTH_CODE"),
        "protocol": "IMAP",
        "imapHost": environment_setting("QQ_MAIL_IMAP_HOST", QQ_IMAP_HOST),
        "imapPort": int(environment_setting("QQ_MAIL_IMAP_PORT", str(QQ_IMAP_PORT)) or QQ_IMAP_PORT),
        "imapSecure": QQ_IMAP_SECURE,
        "smtpHost": environment_setting("QQ_MAIL_SMTP_HOST", QQ_SMTP_HOST),
        "smtpPort": int(environment_setting("QQ_MAIL_SMTP_PORT", str(QQ_SMTP_PORT)) or QQ_SMTP_PORT),
        "smtpSecure": QQ_SMTP_SECURE,
    }


def mail_configured() -> bool:
    config = qq_mail_config()
    return bool(config["address"] and config["authCode"])


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


def mail_settings() -> dict:
    config = qq_mail_config()
    configured = mail_configured()
    return {
        "configured": configured,
        "connected": configured,
        "address": config["address"] if configured else "",
        "protocol": config["protocol"],
        "query": MAIL_QUERY,
        "windowDays": MAIL_WINDOW_DAYS,
        "imap": {
            "host": config["imapHost"],
            "port": config["imapPort"],
            "secure": config["imapSecure"],
        },
        "smtp": {
            "host": config["smtpHost"],
            "port": config["smtpPort"],
            "secure": config["smtpSecure"],
        },
        "updatedAt": None,
    }


def qq_imap_connection(config: dict | None = None) -> imaplib.IMAP4_SSL:
    mail_config = config or qq_mail_config()
    address = mail_config.get("address")
    auth_code = mail_config.get("authCode")
    if not address or not auth_code:
        raise RuntimeError("请先配置 QQ 邮箱地址和授权码")
    try:
        connection = imaplib.IMAP4_SSL(
            str(mail_config.get("imapHost") or QQ_IMAP_HOST),
            int(mail_config.get("imapPort") or QQ_IMAP_PORT),
            timeout=12,
        )
        connection.login(str(address), str(auth_code))
        return connection
    except (imaplib.IMAP4.error, OSError, TimeoutError) as error:
        raise RuntimeError(f"QQ 邮箱 IMAP 连接失败：{error}") from error


def connect_qq_mail() -> dict:
    connection = qq_imap_connection()
    try:
        connection.select("INBOX", readonly=True)
    finally:
        try:
            connection.logout()
        except imaplib.IMAP4.error:
            pass
    return {"connected": True, **mail_settings()}


def decode_mail_entities(value: str) -> str:
    text = str(value or "")
    # QQ mail content can encode entities twice (for example, &amp;nbsp;).
    # Decode twice so that summaries never expose markup such as "&nbsp;".
    for _ in range(2):
        decoded = unescape(text)
        if decoded == text:
            break
        text = decoded
    return text


def clean_mail_text(value: str, limit: int = 220) -> str:
    text = re.sub(r"<[^>]+>", " ", decode_mail_entities(value))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit].rstrip()


def clean_mail_header_text(value: str, limit: int = 220) -> str:
    text = unescape(re.sub(r"\s+", " ", value or "")).strip()
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


def decode_mail_header(value: str | None, default: str = "") -> str:
    if not value:
        return default
    try:
        return str(make_header(decode_header(str(value))))
    except (UnicodeDecodeError, ValueError, LookupError):
        return value


def extract_message_text(message: Message, limit: int = 220) -> str:
    if message.is_multipart():
        for part in message.walk():
            content_type = part.get_content_type()
            disposition = str(part.get("Content-Disposition") or "").lower()
            if content_type in {"text/plain", "text/html"} and "attachment" not in disposition:
                text = extract_message_text(part, limit)
                if text:
                    return text
        return ""
    try:
        payload = message.get_content()
    except (KeyError, LookupError, UnicodeDecodeError):
        payload_bytes = message.get_payload(decode=True) or b""
        charset = message.get_content_charset() or "utf-8"
        payload = payload_bytes.decode(charset, "replace")
    return clean_mail_text(str(payload), limit=limit)


def message_body_parts(message: Message) -> tuple[str, str, list[dict]]:
    text_parts = []
    html_parts = []
    attachments = []
    parts = message.walk() if message.is_multipart() else [message]
    for part in parts:
        if part.is_multipart():
            continue
        content_type = part.get_content_type()
        disposition = str(part.get("Content-Disposition") or "").lower()
        filename = decode_mail_header(part.get_filename() or "")
        if filename or "attachment" in disposition:
            payload = part.get_payload(decode=True) or b""
            attachments.append({
                "filename": clean_mail_header_text(filename or "attachment", limit=180),
                "contentType": content_type,
                "size": len(payload),
            })
            continue
        if content_type not in {"text/plain", "text/html"}:
            continue
        try:
            payload = part.get_content()
        except (KeyError, LookupError, UnicodeDecodeError):
            payload_bytes = part.get_payload(decode=True) or b""
            charset = part.get_content_charset() or "utf-8"
            payload = payload_bytes.decode(charset, "replace")
        if content_type == "text/plain":
            text_parts.append(decode_mail_entities(payload).replace("\xa0", " ").strip())
        else:
            html_parts.append(str(payload).strip())
    return "\n\n".join(part for part in text_parts if part), "\n\n".join(part for part in html_parts if part), attachments


def parse_imap_message(uid: str, raw_message: bytes, flags: list[str] | None = None) -> dict:
    message = message_from_bytes(raw_message, policy=policy.default)
    label_ids = ["INBOX"]
    normalized_flags = {flag.upper() for flag in (flags or [])}
    if "\\SEEN" not in normalized_flags:
        label_ids.append("UNREAD")
    subject = clean_mail_text(decode_mail_header(message.get("Subject"), "(无主题)"), limit=160) or "(无主题)"
    from_value = message.get("From")
    if hasattr(from_value, "addresses") and from_value.addresses:
        first_address = from_value.addresses[0]
        display_name = first_address.display_name
        address = first_address.addr_spec
        from_header = f"{display_name} <{address}>".strip() if display_name else address
    else:
        from_header = str(from_value or "Unknown sender")
        display_name, address = email.utils.parseaddr(from_header)
    sender = clean_mail_header_text(f"{display_name} <{address}>".strip() if display_name else address or from_header, limit=160) or "Unknown sender"
    summary = extract_message_text(message, limit=220) or "暂无可用摘要"
    sent_at = 0
    try:
        sent_datetime = email.utils.parsedate_to_datetime(message.get("Date"))
        if sent_datetime:
            if sent_datetime.tzinfo is None:
                sent_datetime = sent_datetime.replace(tzinfo=timezone.utc)
            sent_at = int(sent_datetime.timestamp() * 1000)
    except (TypeError, ValueError, OverflowError):
        sent_at = 0
    return {
        "uid": uid,
        "messageId": uid,
        "threadId": uid,
        "sender": sender,
        "subject": subject,
        "sentAt": sent_at,
        "snippet": summary,
        "summary": summary,
        "action": classify_mail_action(subject, summary, label_ids),
        "labels": label_ids,
        "unread": "UNREAD" in label_ids,
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
    try:
        metadata = json.loads(row["metadata"] or "{}")
    except (KeyError, TypeError, json.JSONDecodeError):
        metadata = {}
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
        "metadata": metadata if isinstance(metadata, dict) else {},
    }


def normalize_digest_severity(severity: str) -> str:
    value = str(severity or "info").strip().lower()
    return value if value in {"info", "warning", "danger"} else "info"


def notification_digest_record_row_to_item(row: sqlite3.Row) -> dict:
    try:
        payload = json.loads(row["payload"])
    except (TypeError, json.JSONDecodeError):
        payload = {}
    return {
        "id": int(row["id"]),
        "source": row["source"],
        "model": row["model"] or None,
        "title": row["title"],
        "summary": row["summary"],
        "content": row["content"],
        "severity": row["severity"],
        "category": row["category"],
        "iconKey": row["icon_key"],
        "unreadCount": int(row["unread_count"]),
        "generatedAt": int(row["generated_at"]),
        "generatedAtIso": row["generated_at_iso"],
        "createdAt": int(row["created_at"]),
        "payload": payload if isinstance(payload, dict) else {},
    }


def persist_notification_digest_record(payload: NotificationDigestRecordPayload) -> dict:
    generated_at = int(payload.generatedAt or utc_epoch_seconds() * 1000)
    created_at = utc_epoch_seconds() * 1000
    title = clean_mail_text(payload.title, limit=120) or "智能摘要"
    summary = clean_mail_text(payload.summary, limit=500) or title
    content = clean_mail_text(payload.content or f"{title} {summary}", limit=800) or summary
    severity = normalize_digest_severity(payload.severity)
    category = clean_mail_text(payload.category, limit=40).lower() or "system"
    icon_key = clean_mail_text(payload.iconKey, limit=80) or "bell"
    source = normalize_notification_source(payload.source)
    model = clean_mail_text(payload.model or "", limit=80)
    unread_count = max(0, int(payload.unreadCount or 0))
    source_ids = [
        clean_mail_text(str(item), limit=160)
        for item in (payload.sourceIds or [])
        if clean_mail_text(str(item), limit=160)
    ]
    stored_payload = json.dumps({
        "sourceIds": source_ids,
        "generatedAtIso": datetime.fromtimestamp(generated_at / 1000, tz=timezone.utc).isoformat(),
    }, ensure_ascii=False)
    with closing(connect()) as connection:
        cursor = connection.execute(
            """
            INSERT INTO notification_digest_records
            (source, model, title, summary, content, severity, category, icon_key, unread_count, generated_at, generated_at_iso, created_at, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                source,
                model,
                title,
                summary,
                content,
                severity,
                category,
                icon_key,
                unread_count,
                generated_at,
                datetime.fromtimestamp(generated_at / 1000, tz=timezone.utc).isoformat(),
                created_at,
                stored_payload,
            ),
        )
        row = connection.execute(
            """
            SELECT id, source, model, title, summary, content, severity, category, icon_key, unread_count, generated_at, generated_at_iso, created_at, payload
            FROM notification_digest_records
            WHERE id = ?
            """,
            (cursor.lastrowid,),
        ).fetchone()
        connection.commit()
    return notification_digest_record_row_to_item(row)


def notification_digest_records(limit: int = 20) -> dict:
    safe_limit = max(1, min(100, int(limit or 20)))
    with closing(connect()) as connection:
        rows = connection.execute(
            """
            SELECT id, source, model, title, summary, content, severity, category, icon_key, unread_count, generated_at, generated_at_iso, created_at, payload
            FROM notification_digest_records
            ORDER BY generated_at DESC, id DESC
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()
    items = [notification_digest_record_row_to_item(row) for row in rows]
    return {
        "items": items,
        "updatedAt": utc_epoch_seconds() * 1000,
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
    metadata: dict | None = None,
    unread: bool | None = None,
) -> dict:
    normalized_source = normalize_notification_source(source)
    safe_title = clean_mail_text(title, limit=180) or "WinPlate 通知"
    safe_message = clean_mail_text(message, limit=360)
    safe_level = normalize_notification_level(level)
    safe_metadata = metadata if isinstance(metadata, dict) else {}
    metadata_json = json.dumps(safe_metadata, ensure_ascii=False, separators=(",", ":"))
    now = utc_epoch_seconds() * 1000
    created = int(created_at or now)
    insert_unread = 1 if unread is None else int(bool(unread))
    unread_update_sql = "" if unread is None else ", unread = excluded.unread"
    with closing(connect()) as connection:
        connection.execute(
            f"""
            INSERT INTO notifications
            (id, source, level, title, message, unread, created_at, updated_at, external_url, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                source = excluded.source,
                level = excluded.level,
                title = excluded.title,
                message = excluded.message,
                updated_at = excluded.updated_at,
                external_url = excluded.external_url,
                metadata = excluded.metadata
                {unread_update_sql}
            """,
            (
                notification_id,
                normalized_source,
                safe_level,
                safe_title,
                safe_message,
                insert_unread,
                created,
                now,
                external_url,
                metadata_json,
            ),
        )
        row = connection.execute(
            """
            SELECT id, source, level, title, message, unread, created_at, updated_at, external_url, metadata
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
        notification_id = f"mail:{message_id}"
        if not bool(item.get("unread")):
            with closing(connect()) as connection:
                connection.execute("DELETE FROM notifications WHERE id = ?", (notification_id,))
                connection.commit()
            continue
        upsert_notification(
            notification_id=notification_id,
            source="mail",
            level="info",
            title=f"新邮件：{item.get('subject') or '(无主题)'}",
            message=str(item.get("sender") or item.get("summary") or ""),
            created_at=int(item.get("sentAt") or 0) or None,
            external_url=(
                "https://mail.qq.com/"
                if item.get("threadId") else None
            ),
            unread=bool(item.get("unread")),
        )


def windows_notification_database_path() -> Path:
    local_app_data = os.getenv("LOCALAPPDATA")
    if not local_app_data:
        return Path()
    return Path(local_app_data) / "Microsoft" / "Windows" / "Notifications" / "wpndatabase.db"


def windows_filetime_to_epoch_ms(value: int | None) -> int:
    if not value:
        return utc_epoch_seconds() * 1000
    return max(0, int(value / 10_000) - WINDOWS_FILETIME_EPOCH_MS)


def openai_notification_source(primary_id: str | None) -> str | None:
    value = str(primary_id or "")
    for prefix, source in OPENAI_NOTIFICATION_HANDLERS.items():
        if prefix in value:
            return source
    return None


def notification_payload_texts(payload: bytes | str | None) -> list[str]:
    if not payload:
        return []
    xml_text = payload.decode("utf-8", "ignore") if isinstance(payload, bytes) else str(payload)
    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError:
        return []
    texts = []
    for element in root.iter():
        if element.tag.rsplit("}", 1)[-1] != "text":
            continue
        text = clean_mail_text("".join(element.itertext()), limit=360)
        if text:
            texts.append(text)
    return texts


def sync_openai_desktop_notifications(limit: int = 80) -> None:
    if os.name != "nt":
        return
    database_path = windows_notification_database_path()
    if not database_path.exists():
        return
    try:
        source_connection = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
        source_connection.row_factory = sqlite3.Row
        with closing(source_connection) as source:
            rows = source.execute(
                """
                SELECT n.Id, n.Payload, n.ArrivalTime, h.PrimaryId
                FROM Notification n
                LEFT JOIN NotificationHandler h ON n.HandlerId = h.RecordId
                WHERE n.Type = 'toast'
                ORDER BY n.ArrivalTime DESC
                LIMIT ?
                """,
                (max(1, min(200, int(limit or 80))),),
            ).fetchall()
    except sqlite3.Error:
        return

    imported_at = utc_epoch_seconds() * 1000
    with closing(connect()) as connection:
        for row in rows:
            source = openai_notification_source(row["PrimaryId"])
            if not source:
                continue
            texts = notification_payload_texts(row["Payload"])
            if not texts:
                continue
            arrival = windows_filetime_to_epoch_ms(row["ArrivalTime"])
            import_id = f"windows-toast:{source}:{row['Id']}:{row['ArrivalTime']}"
            already_imported = connection.execute(
                "SELECT 1 FROM notification_imports WHERE id = ?",
                (import_id,),
            ).fetchone()
            if already_imported:
                continue
            title = texts[0]
            message = "\n".join(texts[1:]) if len(texts) > 1 else ""
            connection.execute(
                """
                INSERT INTO notifications
                (id, source, level, title, message, unread, created_at, updated_at, external_url)
                VALUES (?, ?, 'success', ?, ?, 1, ?, ?, NULL)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    message = excluded.message,
                    updated_at = excluded.updated_at
                """,
                (
                    import_id,
                    source,
                    clean_mail_text(title, limit=180) or "OpenAI 任务完成",
                    clean_mail_text(message, limit=360),
                    arrival,
                    imported_at,
                ),
            )
            connection.execute(
                "INSERT OR IGNORE INTO notification_imports (id, source, imported_at) VALUES (?, ?, ?)",
                (import_id, source, imported_at),
            )
        connection.commit()


def notification_summary(limit: int = 50) -> dict:
    sync_openai_desktop_notifications()
    safe_limit = max(1, min(50, int(limit or 50)))
    with closing(connect()) as connection:
        rows = connection.execute(
            """
            SELECT id, source, level, title, message, unread, created_at, updated_at, external_url, metadata
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


def set_mail_notification_unread_state(uid: str, unread: bool) -> None:
    with closing(connect()) as connection:
        connection.execute(
            "UPDATE notifications SET unread = ?, updated_at = ? WHERE id = ?",
            (1 if unread else 0, utc_epoch_seconds() * 1000, f"mail:{uid}"),
        )
        connection.commit()


def apply_mail_seen_flag(connection: imaplib.IMAP4_SSL, uid: str, seen: bool) -> None:
    operation = "+FLAGS.SILENT" if seen else "-FLAGS.SILENT"
    status, _ = connection.uid("STORE", uid, operation, r"(\Seen)")
    if status != "OK":
        raise RuntimeError("邮件已读状态同步失败")


def mark_mail_notification_read(uid: str) -> None:
    safe_uid = str(uid or "").strip()
    if not safe_uid or not re.fullmatch(r"[0-9A-Za-z._:-]{1,80}", safe_uid):
        raise RuntimeError("邮件 UID 无效")
    if not mail_configured():
        raise RuntimeError("请先配置 QQ 邮箱地址和授权码")
    connection = qq_imap_connection()
    try:
        status, _ = connection.select("INBOX", readonly=False)
        if status != "OK":
            raise RuntimeError("QQ 邮箱 INBOX 打开失败")
        apply_mail_seen_flag(connection, safe_uid, True)
        update_cached_mail_read_state(safe_uid, unread=False)
        set_mail_notification_unread_state(safe_uid, unread=False)
    except (imaplib.IMAP4.error, OSError, TimeoutError) as error:
        raise RuntimeError(f"QQ 邮箱 IMAP 读取失败：{error}") from error
    finally:
        try:
            connection.logout()
        except imaplib.IMAP4.error:
            pass


def mark_notification_read(notification_id: str) -> dict:
    safe_notification_id = str(notification_id or "").strip()
    if safe_notification_id.startswith("mail:"):
        mark_mail_notification_read(safe_notification_id.split(":", 1)[1])
        return notification_summary()
    with closing(connect()) as connection:
        connection.execute(
            "UPDATE notifications SET unread = 0, updated_at = ? WHERE id = ?",
            (utc_epoch_seconds() * 1000, safe_notification_id),
        )
        connection.commit()
    return notification_summary()


def mark_development_notifications_read(notification_ids: list[str]) -> dict:
    if not isinstance(notification_ids, list):
        raise RuntimeError("开发通知标识无效")
    ids = [str(value or "").strip() for value in notification_ids]
    if not ids or any(not value for value in ids) or len(set(ids)) != len(ids):
        raise RuntimeError("开发通知标识无效")
    placeholders = ", ".join("?" for _ in ids)
    with closing(connect()) as connection:
        rows = connection.execute(
            f"SELECT id, source FROM notifications WHERE id IN ({placeholders})",
            ids,
        ).fetchall()
        if len(rows) != len(ids) or any(row["source"] not in {"codex", "chatgpt"} for row in rows):
            raise RuntimeError("只能批量标记开发通知")
        connection.execute(
            f"UPDATE notifications SET unread = 0, updated_at = ? WHERE id IN ({placeholders})",
            [utc_epoch_seconds() * 1000, *ids],
        )
        connection.commit()
    return notification_summary()


def mark_all_notifications_read() -> dict:
    with closing(connect()) as connection:
        mail_notification_ids = [
            row["id"]
            for row in connection.execute(
                "SELECT id FROM notifications WHERE unread = 1 AND source = 'mail'"
            ).fetchall()
        ]
    for notification_id in mail_notification_ids:
        mark_mail_notification_read(str(notification_id).split(":", 1)[1])
    with closing(connect()) as connection:
        connection.execute(
            "UPDATE notifications SET unread = 0, updated_at = ? WHERE unread = 1",
            (utc_epoch_seconds() * 1000,),
        )
        connection.commit()
    return notification_summary()


def clear_notifications() -> dict:
    with closing(connect()) as connection:
        connection.execute("DELETE FROM notifications")
        connection.commit()
    return notification_summary()


def clear_read_notifications() -> dict:
    with closing(connect()) as connection:
        connection.execute("DELETE FROM notifications WHERE unread = 0")
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
            (MAIL_MAX_RESULTS,),
        ).fetchall()
    items = []
    for row in rows:
        try:
            labels = json.loads(row["labels"])
        except (TypeError, json.JSONDecodeError):
            labels = []
        items.append({
            "uid": row["message_id"],
            "messageId": row["message_id"],
            "threadId": row["thread_id"],
            "sender": row["sender"],
            "subject": row["subject"],
            "sentAt": int(row["sent_at"]),
            "snippet": row["snippet"],
            "summary": row["summary"],
            "action": row["action"],
            "labels": labels if isinstance(labels, list) else [],
            "unread": "UNREAD" in labels if isinstance(labels, list) else False,
            "cachedAt": int(row["updated_at"]),
        })
    return items


def update_cached_mail_read_state(uid: str, unread: bool) -> None:
    with closing(connect()) as connection:
        row = connection.execute(
            "SELECT labels FROM mail_outline_cache WHERE message_id = ?",
            (uid,),
        ).fetchone()
        if row:
            try:
                labels = json.loads(row["labels"])
            except (TypeError, json.JSONDecodeError):
                labels = []
            if not isinstance(labels, list):
                labels = []
            labels = [label for label in labels if label != "UNREAD"]
            if unread and "UNREAD" not in labels:
                labels.append("UNREAD")
            action = "查看" if unread else "归档参考"
            connection.execute(
                "UPDATE mail_outline_cache SET labels = ?, action = ?, updated_at = ? WHERE message_id = ?",
                (json.dumps(labels), action, utc_epoch_seconds() * 1000, uid),
            )
        connection.commit()


def imap_ids(payload: list[bytes]) -> list[str]:
    if not payload or not payload[0]:
        return []
    return [item.decode("ascii", "ignore") for item in payload[0].split() if item]


def parse_imap_flags(fetch_header: bytes) -> list[str]:
    match = re.search(rb"FLAGS \(([^)]*)\)", fetch_header or b"")
    if not match:
        return []
    return [flag.decode("ascii", "ignore") for flag in match.group(1).split()]


def parse_imap_fetch_payload(fetched: list[bytes | tuple[bytes, bytes]]) -> tuple[bytes | None, list[str]]:
    metadata_parts: list[bytes] = []
    raw_message: bytes | None = None
    for part in fetched:
        if isinstance(part, tuple):
            metadata_parts.append(part[0])
            if raw_message is None:
                raw_message = part[1]
        elif isinstance(part, bytes):
            metadata_parts.append(part)
    return raw_message, parse_imap_flags(b" ".join(metadata_parts))


def read_mail_outline_from_qq() -> tuple[list[dict], int]:
    since = datetime.fromtimestamp(utc_epoch_seconds() - MAIL_WINDOW_DAYS * 86400).strftime("%d-%b-%Y")
    connection = qq_imap_connection()
    try:
        status, _ = connection.select("INBOX", readonly=True)
        if status != "OK":
            raise RuntimeError("QQ 邮箱 INBOX 打开失败")
        _unread_status, unread_payload = connection.uid("SEARCH", None, "UNSEEN")
        unread_count = len(imap_ids(unread_payload))
        _search_status, search_payload = connection.uid("SEARCH", None, "SINCE", since)
        candidates = imap_ids(search_payload)[-MAIL_CANDIDATE_RESULTS:]
        candidates.reverse()
        outlines = []
        for uid in candidates:
            status, fetched = connection.uid("FETCH", uid, "(BODY.PEEK[] FLAGS)")
            if status != "OK":
                continue
            raw_message, flags = parse_imap_fetch_payload(fetched)
            if not raw_message:
                continue
            outlines.append(parse_imap_message(uid, raw_message, flags))
            if len(outlines) >= MAIL_MAX_RESULTS:
                break
    except (imaplib.IMAP4.error, OSError, TimeoutError) as error:
        raise RuntimeError(f"QQ 邮箱 IMAP 读取失败：{error}") from error
    finally:
        try:
            connection.logout()
        except imaplib.IMAP4.error:
            pass
    outlines.sort(key=lambda item: item.get("sentAt", 0), reverse=True)
    return outlines, unread_count


def read_mail_message(uid: str, mark_read: bool = False) -> dict:
    safe_uid = str(uid or "").strip()
    if not safe_uid or not re.fullmatch(r"[0-9A-Za-z._:-]{1,80}", safe_uid):
        raise RuntimeError("邮件 UID 无效")
    if not mail_configured():
        raise RuntimeError("请先配置 QQ 邮箱地址和授权码")
    connection = qq_imap_connection()
    try:
        status, _ = connection.select("INBOX", readonly=not mark_read)
        if status != "OK":
            raise RuntimeError("QQ 邮箱 INBOX 打开失败")
        status, fetched = connection.uid("FETCH", safe_uid, "(BODY.PEEK[] FLAGS)")
        if status != "OK":
            raise RuntimeError("邮件读取失败")
        raw_message, flags = parse_imap_fetch_payload(fetched)
        if not raw_message:
            raise RuntimeError("邮件不存在或已无法读取")
        parsed = parse_imap_message(safe_uid, raw_message, flags)
        message = message_from_bytes(raw_message, policy=policy.default)
        text_body, html_body, attachments = message_body_parts(message)
        unread_before = bool(parsed.get("unread"))
        unread_after = unread_before
        if mark_read and unread_before:
            apply_mail_seen_flag(connection, safe_uid, True)
            unread_after = False
            parsed["labels"] = [label for label in parsed["labels"] if label != "UNREAD"]
            parsed["action"] = classify_mail_action(parsed["subject"], parsed["summary"], parsed["labels"])
            update_cached_mail_read_state(safe_uid, unread=False)
            set_mail_notification_unread_state(safe_uid, unread=False)
        return {
            **parsed,
            "from": parsed["sender"],
            "to": clean_mail_header_text(decode_mail_header(message.get("To"), ""), limit=320),
            "date": clean_mail_header_text(decode_mail_header(message.get("Date"), ""), limit=120),
            "textBody": text_body,
            "htmlBody": html_body,
            "attachments": attachments,
            "unread": unread_after,
            "markedRead": unread_before and not unread_after,
        }
    except (imaplib.IMAP4.error, OSError, TimeoutError) as error:
        raise RuntimeError(f"QQ 邮箱 IMAP 读取失败：{error}") from error
    finally:
        try:
            connection.logout()
        except imaplib.IMAP4.error:
            pass


def mail_outline(force: bool = False) -> dict:
    if not mail_configured():
        return {
            "source": "unconfigured",
            "availability": "unconfigured",
            "query": MAIL_QUERY,
            "windowDays": MAIL_WINDOW_DAYS,
            "items": cached_mail_outline(),
            "updatedAt": None,
            "unreadCount": 0,
            "error": "请先配置 QQ 邮箱地址和授权码",
        }
    if not force:
        cached = cached_mail_outline()
        if cached:
            return {
                "source": "qq-mail-cache",
                "availability": "cached",
                "query": MAIL_QUERY,
                "windowDays": MAIL_WINDOW_DAYS,
                "items": cached,
                "unreadCount": None,
                "updatedAt": max((item.get("cachedAt", 0) for item in cached), default=None),
            }
    try:
        items, unread_count = read_mail_outline_from_qq()
        persist_mail_outline(items)
        sync_mail_notifications(items)
        return {
            "source": "qq-mail",
            "availability": "live",
            "query": MAIL_QUERY,
            "windowDays": MAIL_WINDOW_DAYS,
            "items": items,
            "unreadCount": unread_count,
            "updatedAt": utc_epoch_seconds() * 1000,
        }
    except RuntimeError as error:
        cached = cached_mail_outline()
        return {
            "source": "qq-mail-cache" if cached else "unavailable",
            "availability": "cached" if cached else "unavailable",
            "query": MAIL_QUERY,
            "windowDays": MAIL_WINDOW_DAYS,
            "items": cached,
            "unreadCount": None,
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
                ,metadata TEXT NOT NULL DEFAULT '{}'
            )
            """
        )
        notification_columns = {row["name"] for row in connection.execute("PRAGMA table_info(notifications)")}
        if "metadata" not in notification_columns:
            connection.execute("ALTER TABLE notifications ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'")
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_notifications_unread_created ON notifications (unread, created_at)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS notification_imports (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                imported_at INTEGER NOT NULL
            )
            """
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
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS notification_digest_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                model TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                content TEXT NOT NULL,
                severity TEXT NOT NULL,
                category TEXT NOT NULL,
                icon_key TEXT NOT NULL,
                unread_count INTEGER NOT NULL DEFAULT 0,
                generated_at INTEGER NOT NULL,
                generated_at_iso TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                payload TEXT NOT NULL DEFAULT '{}'
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_notification_digest_records_generated ON notification_digest_records (generated_at DESC, id DESC)"
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
            payload = _decode_qweather_json(
                response.read(),
                getattr(response, "headers", {}).get("Content-Encoding", ""),
            )
    except HTTPError as error:
        raise RuntimeError(f"QWeather API returned HTTP {error.code}") from error
    except (URLError, TimeoutError) as error:
        raise RuntimeError(f"QWeather API unavailable: {error}") from error
    except (gzip.BadGzipFile, UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
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
            INSERT INTO qweather_usage (month, request_count) VALUES (?, 1)
            ON CONFLICT(month) DO UPDATE SET request_count = request_count + 1
            """,
            (month,),
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
        row = connection.execute(
            "SELECT request_count FROM qweather_usage WHERE month = ?",
            (month,),
        ).fetchone()
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
    try:
        token = jwt.encode(
            {"sub": project_id, "iat": now - 30, "exp": now + 900},
            private_key.replace("\\n", "\n"),
            algorithm="EdDSA",
            headers={"kid": credential_id},
        )
    except ValueError as error:
        raise RuntimeError("QWeather 私钥格式无效，请重新粘贴完整的 Ed25519 PEM 私钥") from error
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
        message = f"QWeather 接口返回 HTTP {error.code}"
        if detail:
            message = f"{message}: {detail}"
        elif error.code == 400:
            message = f"{message}，请检查该凭据的 Console API 请求量统计权限"
        raise RuntimeError(message) from error
    except (URLError, TimeoutError) as error:
        raise RuntimeError(f"QWeather 接口不可用: {error}") from error
    except (gzip.BadGzipFile, UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise RuntimeError("QWeather 接口返回了无效响应") from error


def qweather_official_stats() -> dict:
    payload = qweather_jwt_request("/metrics/v1/stats")

    success = _sum_named_metric(payload, "success")
    errors = _sum_named_metric(payload, "errors")
    return {
        "total": success + errors,
        "success": success,
        "errors": errors,
        "asOf": payload.get("asOf") or payload.get("updateTime") or datetime.now(timezone.utc).isoformat(),
    }


def qweather_coord_query(longitude: float, latitude: float) -> str:
    return f"{longitude:.2f},{latitude:.2f}"


def is_qweather_location_id(location: str) -> bool:
    return bool(re.fullmatch(r"\d+", str(location or "").strip()))


def is_qweather_coord_query(location: str) -> bool:
    return bool(re.fullmatch(r"-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?", str(location or "").strip()))


def qweather_display_location(place: dict | None, fallback: str = "") -> str:
    if not isinstance(place, dict):
        return fallback
    name = clean_mail_text(str(place.get("name") or fallback), limit=80)
    adm1 = clean_mail_text(str(place.get("adm1") or ""), limit=80)
    return f"{name}, {adm1}" if name and adm1 and adm1 != name else name or fallback


def qweather_search_locations(query: str, number: int = 10) -> list[dict]:
    safe_query = str(query or "").strip()
    if not safe_query:
        return []
    payload = qweather_request(
        "/geo/v2/city/lookup",
        {"location": safe_query, "number": str(number), "lang": "zh"},
    )
    locations = payload.get("location", [])
    if not isinstance(locations, list):
        return []
    results = []
    for place in locations:
        if not isinstance(place, dict):
            continue
        name = str(place.get("name") or "").strip()
        adm1 = str(place.get("adm1") or "").strip()
        country = str(place.get("country") or "").strip()
        display_parts = [part for part in [name, adm1, country] if part]
        results.append({
            "id": str(place.get("id") or "").strip(),
            "name": name,
            "adm1": adm1,
            "adm2": str(place.get("adm2") or "").strip(),
            "country": country,
            "lat": place.get("lat"),
            "lon": place.get("lon"),
            "displayName": " · ".join(display_parts) or name,
        })
    return [item for item in results if item["id"]]


def _weather_visual_context(latitude: float | None, longitude: float | None) -> dict:
    if latitude is None or longitude is None:
        return {"minutelySummary": "", "minutelyPrecipitation": [], "airQuality": None}
    lat = float(latitude)
    lon = float(longitude)
    minutely_summary = ""
    minutely_precipitation = []
    air_quality = None
    try:
        payload = qweather_request(
            "/v7/minutely/5m",
            {"location": qweather_coord_query(lon, lat), "lang": "zh"},
        )
        minutely_summary = clean_mail_text(str(payload.get("summary") or ""), limit=120)
        points = payload.get("minutely") if isinstance(payload.get("minutely"), list) else []
        minutely_precipitation = [
            {
                "time": str(point.get("fxTime") or ""),
                "precipitation": max(0.0, float(point.get("precip") or 0)),
                "type": "snow" if str(point.get("type") or "").lower() == "snow" else "rain",
            }
            for point in points[:24]
            if isinstance(point, dict)
        ]
    except (RuntimeError, TypeError, ValueError):
        pass
    try:
        payload = qweather_jwt_request(
            f"/airquality/v1/current/{lat:.2f}/{lon:.2f}",
            {"lang": "zh"},
        )
        indexes = payload.get("indexes") if isinstance(payload.get("indexes"), list) else []
        index = next(
            (item for item in indexes if isinstance(item, dict) and str(item.get("code") or "").startswith("cn-")),
            next((item for item in indexes if isinstance(item, dict)), None),
        )
        if index:
            color = index.get("color") if isinstance(index.get("color"), dict) else {}
            air_quality = {
                "aqi": float(index["aqi"]) if index.get("aqi") is not None else None,
                "display": str(index.get("aqiDisplay") or ""),
                "category": str(index.get("category") or ""),
                "color": {
                    "red": int(color.get("red") or 0),
                    "green": int(color.get("green") or 0),
                    "blue": int(color.get("blue") or 0),
                    "alpha": float(color.get("alpha") if color.get("alpha") is not None else 1),
                },
            }
    except (RuntimeError, TypeError, ValueError, KeyError):
        pass
    return {
        "minutelySummary": minutely_summary,
        "minutelyPrecipitation": minutely_precipitation,
        "airQuality": air_quality,
    }


def build_weather_status(
    location: str,
    display_location: str | None = None,
    location_source: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
) -> dict:
    query = str(location or "").strip()
    place = None
    weather_location = query
    resolved_location = None
    if is_qweather_location_id(query):
        resolved_location = {
            "id": query,
            "name": display_location or query,
            "lat": latitude,
            "lon": longitude,
        }
    else:
        location_payload = qweather_request("/geo/v2/city/lookup", {"location": query, "number": "1", "lang": "zh"})
        matches = location_payload.get("location", [])
        if not matches:
            raise RuntimeError(f"QWeather could not find location: {query}")
        place = matches[0]
        weather_location = place["id"]
        resolved_location = {
            "id": str(place.get("id") or ""),
            "name": str(place.get("name") or ""),
            "adm1": str(place.get("adm1") or ""),
            "adm2": str(place.get("adm2") or ""),
            "country": str(place.get("country") or ""),
            "lat": place.get("lat"),
            "lon": place.get("lon"),
            "displayLocation": qweather_display_location(place, query),
        }
    weather_payload = qweather_request("/v7/weather/now", {"location": weather_location, "lang": "zh", "unit": "m"})
    hourly_payload = qweather_request("/v7/weather/24h", {"location": weather_location, "lang": "zh", "unit": "m"})
    daily_payload = qweather_request("/v7/weather/7d", {"location": weather_location, "lang": "zh", "unit": "m"})
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
    cloud_cover = int(float(now.get("cloud") or 0))
    wind_speed = float(now.get("windSpeed") or 0)
    wind_degrees = int(float(now.get("wind360") or 0))
    hourly = hourly_payload.get("hourly", [])
    daily = daily_payload.get("daily", [])
    precipitation_probability = None
    if hourly and isinstance(hourly[0], dict) and str(hourly[0].get("pop", "")).isdigit():
        precipitation_probability = int(hourly[0]["pop"])
    today = daily[0] if daily and isinstance(daily[0], dict) else {}
    day_condition = str(today.get("textDay", "")).strip()
    night_condition = str(today.get("textNight", "")).strip()
    weather_summary = build_weather_summary(
        temperature,
        feels_like,
        day_condition,
        night_condition,
        str(now.get("windDir", "")),
        str(now.get("windScale", "")),
        precipitation,
        precipitation_probability,
        humidity,
        visibility,
    )
    place_name = place.get("name", query) if place else (display_location or query)
    admin = place.get("adm1") if place else ""
    forecast = [
        {
            "date": item.get("fxDate", ""),
            "icon": str(item.get("iconDay", "999")),
            "condition": item.get("textDay", "未知"),
            "tempMax": int(float(item["tempMax"])),
            "tempMin": int(float(item["tempMin"])),
            "precipitationProbability": int(item["precip"]) if str(item.get("precip", "")).isdigit() else None,
        }
        for item in daily[:5]
        if isinstance(item, dict) and item.get("tempMax") is not None and item.get("tempMin") is not None
    ]
    resolved_latitude = resolved_location.get("lat") if isinstance(resolved_location, dict) else latitude
    resolved_longitude = resolved_location.get("lon") if isinstance(resolved_location, dict) else longitude
    visual_context = _weather_visual_context(resolved_latitude, resolved_longitude)
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
        "cloudCover": cloud_cover,
        "windSpeed": wind_speed,
        "windDegrees": wind_degrees,
        "precipitationProbability": precipitation_probability,
        "weatherSummary": weather_summary,
        "forecast": forecast,
        "windDirection": now.get("windDir", ""),
        "windScale": now.get("windScale", ""),
        "observedAt": now.get("obsTime", ""),
        "updatedAt": weather_payload.get("updateTime", ""),
        "locationId": weather_location,
        "locationSource": location_source or "",
        "resolvedLocation": resolved_location,
        **visual_context,
    }


def build_weather_wind_phrase(wind_direction: str, wind_scale: str) -> str:
    direction = str(wind_direction or "").strip()
    scale = str(wind_scale or "").strip()
    if direction and scale:
        return f"{direction}{scale}级"
    if direction:
        return direction
    if scale:
        return f"{scale}级风"
    return ""


def build_weather_notice(
    day_condition: str,
    night_condition: str,
    precipitation: float,
    precipitation_probability: int | None,
    humidity: int,
    visibility: int,
) -> str:
    combined_condition = f"{day_condition} {night_condition}".strip()
    wet_keywords = ("雨", "雪", "雷", "冰雹")
    has_wet_weather = any(keyword in combined_condition for keyword in wet_keywords)
    if has_wet_weather or precipitation >= 0.2 or (precipitation_probability is not None and precipitation_probability >= 50):
        return "出门记得带伞"
    if humidity >= 85:
        return "空气湿润"
    if humidity <= 35:
        return "空气偏干"
    if visibility >= 15:
        return "视野比较通透"
    return ""


def build_weather_summary(
    temperature: int,
    feels_like: int,
    day_condition: str,
    night_condition: str,
    wind_direction: str,
    wind_scale: str,
    precipitation: float,
    precipitation_probability: int | None,
    humidity: int,
    visibility: int,
) -> str:
    summary_parts = []
    if day_condition and night_condition:
        summary_parts.append(f"今天白天{day_condition}，夜晚{night_condition}")
    elif day_condition:
        summary_parts.append(f"今天白天{day_condition}")
    elif night_condition:
        summary_parts.append(f"今天夜晚{night_condition}")
    summary_parts.append(f"现在{temperature}°")
    if abs(feels_like - temperature) >= 3:
        trend = "会更闷热一些" if feels_like > temperature else "会更凉一些"
        summary_parts.append(f"体感{feels_like}°，{trend}")
    else:
        summary_parts.append(f"体感{feels_like}°")
    wind_phrase = build_weather_wind_phrase(wind_direction, wind_scale)
    if wind_phrase:
        summary_parts.append(wind_phrase)
    notice = build_weather_notice(
        day_condition,
        night_condition,
        precipitation,
        precipitation_probability,
        humidity,
        visibility,
    )
    if notice:
        summary_parts.append(notice)
    return "，".join(summary_parts) + "。"


def weather_status(
    location: str | None = None,
    force: bool = False,
    display_location: str | None = None,
    location_source: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
) -> dict:
    query = location or QWEATHER_LOCATION
    if not query:
        return deepcopy(DEFAULT_STATUS["weather"])
    now = time.monotonic()
    with _weather_cache_lock:
        cached = _weather_cache.get(query)
    if not force and cached and now - cached[0] < QWEATHER_CACHE_SECONDS:
        return cached[1]
    data = build_weather_status(
        query,
        display_location=display_location,
        location_source=location_source,
        latitude=latitude,
        longitude=longitude,
    )
    with _weather_cache_lock:
        _weather_cache[query] = (now, data)
    return data


def persist_weather_location(
    latitude: float | None = None,
    longitude: float | None = None,
    display_location: str | None = None,
    *,
    source: str = "system",
    query: str | None = None,
    location_id: str | None = None,
    name: str | None = None,
    adm1: str | None = None,
) -> None:
    if source not in {"manual", "system", "ip", "env"}:
        raise ValueError("Invalid weather location source")
    saved_query = query or location_id
    if not saved_query and latitude is not None and longitude is not None:
        saved_query = qweather_coord_query(float(longitude), float(latitude))
    if not saved_query:
        raise ValueError("Weather location query is required")
    payload = {
        "source": source,
        "query": saved_query,
        "locationId": location_id,
        "name": name,
        "adm1": adm1,
        "latitude": float(latitude) if latitude is not None else None,
        "longitude": float(longitude) if longitude is not None else None,
        "displayLocation": display_location,
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
    query = str(payload.get("query") or "").strip()
    latitude = payload.get("latitude")
    longitude = payload.get("longitude")
    if not query and isinstance(latitude, (int, float)) and isinstance(longitude, (int, float)):
        query = qweather_coord_query(float(longitude), float(latitude))
    if not query:
        return None
    result = {
        "source": str(payload.get("source") or "system"),
        "query": query,
        "locationId": str(payload.get("locationId") or "") or None,
        "name": clean_mail_text(str(payload.get("name") or ""), limit=80) or None,
        "adm1": clean_mail_text(str(payload.get("adm1") or ""), limit=80) or None,
    }
    if isinstance(latitude, (int, float)):
        result["latitude"] = float(latitude)
    if isinstance(longitude, (int, float)):
        result["longitude"] = float(longitude)
    display_location = clean_mail_text(str(payload.get("displayLocation") or ""), limit=80)
    if display_location:
        result["displayLocation"] = display_location
    return result


def localized_weather_alert_title(title: str, display_location: str | None = None) -> str:
    safe_title = clean_mail_text(title, limit=180) or "天气预警"
    safe_location = clean_mail_text(str(display_location or ""), limit=80)
    if not safe_location or safe_location in safe_title:
        return safe_title
    primary_location = safe_location.split(",", 1)[0].strip()
    if primary_location and primary_location in safe_title:
        return safe_title
    return clean_mail_text(f"{safe_location}：{safe_title}", limit=180)


def weather_alert_lifecycle(alert: dict, title: str = "", message: str = "") -> str:
    status = " ".join(
        str(alert.get(key) or "")
        for key in ("status", "action", "eventStatus", "msgType", "type")
    )
    combined = f"{status} {title} {message}"
    if re.search(r"解除|取消|撤销|终止|结束|失效|expired|cancel(?:led|ed)?|resolved|cleared", combined, re.I):
        return "resolved"
    if re.search(r"升级|提升为|升为|upgrade", combined, re.I):
        return "upgraded"
    return "issued"


def qweather_alerts(latitude: float | None = None, longitude: float | None = None) -> dict:
    location = {"latitude": latitude, "longitude": longitude}
    if latitude is None or longitude is None:
        stored = read_weather_location()
        if not stored:
            return {"source": "qweather", "alerts": [], "updatedAt": None, "error": "天气预警需要先获取一次定位"}
        location = stored
    lat = float(location["latitude"])
    lon = float(location["longitude"])
    display_location = str(location.get("displayLocation") or "").strip()
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
        title = localized_weather_alert_title(
            str(alert.get("headline") or alert.get("title") or "天气预警"),
            display_location,
        )
        message = clean_mail_text(str(alert.get("description") or alert.get("text") or ""), limit=360)
        severity = str(alert.get("severity") or alert.get("color") or "warning").lower()
        lifecycle = weather_alert_lifecycle(alert, title, message)
        level = "success" if lifecycle == "resolved" else "critical" if severity in {"red", "extreme", "severe"} else "warning"
        if lifecycle == "resolved" and "风险降低" not in f"{title} {message}":
            message = clean_mail_text(f"预警已解除，风险降低。{message}", limit=360)
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
            "lifecycle": lifecycle,
            "riskDelta": "decreased" if lifecycle == "resolved" else "increased" if lifecycle == "upgraded" else "active",
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
                metadata={
                    "severity": severity,
                    "lifecycle": lifecycle,
                    "riskDelta": normalized_alert["riskDelta"],
                },
            )
    return {
        "source": "qweather",
        "alerts": normalized,
        "updatedAt": utc_epoch_seconds() * 1000,
    }


def qweather_alert_detail(alert_id: str) -> dict:
    safe_alert_id = str(alert_id or "").strip()
    if not safe_alert_id:
        raise RuntimeError("天气预警 ID 不能为空")
    payload = qweather_alerts()
    alerts = payload.get("alerts") if isinstance(payload, dict) else []
    for alert in alerts:
        if str(alert.get("id") or "").strip() == safe_alert_id:
            return {
                **alert,
                "source": "qweather",
                "body": alert.get("message") or "",
            }
    raise RuntimeError("天气预警不存在或已失效")


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


def build_github_contribution_summary(contribution_days: dict[str, int], now: datetime) -> dict:
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
        "commitsThisMonth": current_month["commits"],
        "streakDays": streak_days,
        "contributions30d": [contribution_level(count) for count in daily_counts],
        "contributionMonth": now.strftime("%B"),
        "contributionMonths": contribution_months,
    }


def cached_github_contribution_summary(username: str) -> dict | None:
    cached = cached_github_status()
    if not cached or cached.get("username") != f"@{username}":
        return None
    contribution_months = cached.get("contributionMonths")
    if not isinstance(contribution_months, list) or not contribution_months:
        return None
    contributions30d = cached.get("contributions30d")
    safe_levels = contributions30d[-30:] if isinstance(contributions30d, list) else [0] * 30
    return {
        "commitsThisMonth": int(cached.get("commitsThisMonth") or 0),
        "streakDays": int(cached.get("streakDays") or 0),
        "contributions30d": safe_levels,
        "contributionMonth": str(cached.get("contributionMonth") or ""),
        "contributionMonths": contribution_months,
    }


def github_cached_range_total(username: str, range_type: str, range_key: str) -> int:
    cached = cached_github_status()
    if not cached or cached.get("username") != f"@{username}":
        return 0
    months = cached.get("contributionMonths")
    if not isinstance(months, list):
        return 0
    month_key_text = range_key[:7]
    month = next((item for item in months if isinstance(item, dict) and item.get("key") == month_key_text), None)
    if not month:
        return 0
    if range_type == "month":
        return max(0, int(month.get("commits") or 0))
    try:
        day_index = datetime.strptime(range_key, "%Y-%m-%d").day - 1
        counts = month.get("counts")
        return max(0, int(counts[day_index] or 0)) if isinstance(counts, list) and day_index < len(counts) else 0
    except (TypeError, ValueError, IndexError):
        return 0


def github_contribution_detail(
    username: str,
    *,
    date_text: str | None = None,
    month_text: str | None = None,
) -> dict:
    if bool(date_text) == bool(month_text):
        raise ValueError("exactly one contribution range is required")
    try:
        if date_text:
            start = datetime.strptime(date_text, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            end = start + timedelta(days=1)
            range_type, range_key = "date", date_text
            label = start.strftime("%B %-d, %Y") if os.name != "nt" else start.strftime("%B %#d, %Y")
        else:
            start = datetime.strptime(month_text, "%Y-%m").replace(tzinfo=timezone.utc)
            next_year, next_month = (start.year + 1, 1) if start.month == 12 else (start.year, start.month + 1)
            end = datetime(next_year, next_month, 1, tzinfo=timezone.utc)
            range_type, range_key = "month", month_text or ""
            label = start.strftime("%B %Y")
    except ValueError as error:
        raise ValueError("invalid contribution range") from error

    fallback_total = github_cached_range_total(username, range_type, range_key)
    base = {
        "rangeType": range_type,
        "rangeKey": range_key,
        "label": label,
        "totalCount": fallback_total,
        "repositoryCount": 0,
        "repositories": [],
        "detailsAvailable": False,
    }
    if not github_token():
        return {**base, "message": "Repository details require a GitHub Token."}

    query = """
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
          commitContributionsByRepository(maxRepositories: 100) {
            repository { nameWithOwner url }
            contributions { totalCount }
          }
        }
      }
    }
    """
    variables = {
        "login": username,
        "from": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "to": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    try:
        payload = github_graphql_request(query, variables)
        user = payload.get("data", {}).get("user") if isinstance(payload, dict) else None
        collection = user.get("contributionsCollection") if isinstance(user, dict) else None
        if not isinstance(collection, dict):
            raise RuntimeError("GitHub contribution detail is unavailable")
        repositories = []
        for item in collection.get("commitContributionsByRepository", []):
            repository = item.get("repository") if isinstance(item, dict) else None
            contributions = item.get("contributions") if isinstance(item, dict) else None
            if not isinstance(repository, dict) or not isinstance(contributions, dict):
                continue
            name = repository.get("nameWithOwner")
            url = repository.get("url")
            count = contributions.get("totalCount")
            if isinstance(name, str) and isinstance(url, str) and isinstance(count, int) and count >= 0:
                repositories.append({"nameWithOwner": name, "url": url, "count": count})
        repositories.sort(key=lambda item: (-item["count"], item["nameWithOwner"].lower()))
        total = collection.get("totalCommitContributions")
        return {
            **base,
            "totalCount": max(0, total) if isinstance(total, int) else sum(item["count"] for item in repositories),
            "repositoryCount": len(repositories),
            "repositories": repositories,
            "detailsAvailable": True,
            "message": "",
        }
    except RuntimeError:
        return {**base, "message": "Repository details are temporarily unavailable."}


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
        contribution_error = None
        try:
            contribution_days = futures["contributions"].result()
        except RuntimeError as error:
            contribution_error = error
            contribution_days = None

    if not isinstance(profile, dict) or not isinstance(repositories, list):
        raise RuntimeError("GitHub API returned an unexpected response")

    now = datetime.now(timezone.utc)
    used_cached_contributions = False
    if isinstance(contribution_days, dict):
        contribution_summary = build_github_contribution_summary(contribution_days, now)
    else:
        contribution_summary = cached_github_contribution_summary(username)
        if contribution_summary:
            used_cached_contributions = True
        else:
            contribution_summary = build_github_contribution_summary({}, now)

    repository = repositories[0] if repositories else {}
    display_name = profile.get("name") or profile.get("login") or username
    result = {
        "source": "github",
        "name": display_name,
        "username": f"@{profile.get('login', username)}",
        "profileUrl": profile.get("html_url", f"https://github.com/{username}"),
        "avatarUrl": profile.get("avatar_url", ""),
        "repos": profile.get("public_repos", 0),
        "followers": profile.get("followers", 0),
        "project": repository.get("name", "No public repositories"),
        "status": "Live",
        "language": repository.get("language") or "Unknown",
        "stars": repository.get("stargazers_count", 0),
        "updatedText": repository.get("pushed_at", ""),
        **contribution_summary,
        "updatedAt": int(time.time() * 1000),
    }
    if contribution_error:
        result["stateMessage"] = (
            "GitHub 贡献历史暂时不可用，当前显示最近一次成功同步的数据。"
            if used_cached_contributions
            else "GitHub 贡献历史暂时不可用，当前统计可能不完整。"
        )
    return result


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
        "auth": "GitHub 身份验证不可用，当前显示最近一次成功同步的数据。",
        "rate-limit": "GitHub 请求频率受限，当前显示最近一次成功同步的数据。",
        "slow": "GitHub 响应较慢，当前显示最近一次成功同步的数据。",
        "unavailable": "GitHub 当前不可用，显示最近一次成功同步的数据。",
    }
    normalized = reason if reason in messages else "unavailable"
    return normalized, messages[normalized]


def github_status(force: bool = False) -> dict:
    global _github_cache
    now = time.monotonic()
    username = github_username()
    with _github_cache_lock:
        cached = _github_cache
    if (not force and cached and now - cached[0] < GITHUB_CACHE_SECONDS
            and cached[1].get("username") == f"@{username}"):
        return cached[1]
    try:
        data = build_github_status(username)
        persist_github_status(data)
        with _github_cache_lock:
            _github_cache = (now, data)
        return data
    except RuntimeError as error:
        reason, message = github_failure_state(error)
        cached = cached_github_status()
        if cached and cached.get("username") == f"@{username}":
            return {
                **cached,
                "source": "github-cache",
                "status": "Cached",
                "availability": reason,
                "stateMessage": message,
            }
        return {
            "source": "unavailable",
            "name": username,
            "username": f"@{username}",
            "profileUrl": f"https://github.com/{username}",
            "status": "Unavailable",
            "availability": reason,
            "stateMessage": {
                "auth": "GitHub 身份验证不可用，且当前没有可回退的缓存数据。",
                "rate-limit": "GitHub 请求频率受限，且当前没有可回退的缓存数据。",
                "slow": "GitHub 响应较慢，且当前没有可回退的缓存数据。",
                "unavailable": "GitHub 当前不可用，且当前没有可回退的缓存数据。",
            }[reason],
        }


@api.on_event("startup")
def startup() -> None:
    initialize_database()


@api.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@api.get("/api/modules")
def modules() -> dict[str, list[dict]]:
    return {"modules": public_modules()}


@api.get("/api/status")
def status() -> dict[str, dict]:
    with closing(connect()) as connection:
        rows = connection.execute(
            "SELECT module, payload FROM status_modules ORDER BY module"
        ).fetchall()
    result = {row["module"]: json.loads(row["payload"]) for row in rows}
    result["github"] = github_status()
    if environment_setting("QWEATHER_API_KEY"):
        stored_weather_location = read_weather_location()
        weather_query = stored_weather_location.get("query") if stored_weather_location else QWEATHER_LOCATION
        weather_display = stored_weather_location.get("displayLocation") if stored_weather_location else None
        weather_source = stored_weather_location.get("source") if stored_weather_location else ("env" if QWEATHER_LOCATION else None)
        if weather_query:
            try:
                result["weather"] = weather_status(
                    weather_query,
                    display_location=weather_display,
                    location_source=weather_source,
                    latitude=stored_weather_location.get("latitude") if stored_weather_location else None,
                    longitude=stored_weather_location.get("longitude") if stored_weather_location else None,
                )
            except RuntimeError as error:
                result["weather"] = {**result.get("weather", DEFAULT_STATUS["weather"]), "source": "unavailable", "error": str(error)}
        else:
            result["weather"] = deepcopy(DEFAULT_STATUS["weather"])
    return result


@api.post("/api/github/refresh")
def refresh_github() -> dict:
    return github_status(force=True)


@api.get("/api/github/contributions")
def github_contributions(date: str | None = None, month: str | None = None) -> dict:
    try:
        return github_contribution_detail(
            github_username(),
            date_text=date,
            month_text=month,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@api.post("/api/weather/refresh")
def refresh_weather(location: WeatherLocation | None = None) -> dict:
    try:
        query = None
        if location:
            if not -90 <= location.latitude <= 90 or not -180 <= location.longitude <= 180:
                raise HTTPException(status_code=422, detail="经纬度无效")
            query = qweather_coord_query(location.longitude, location.latitude)
        data = weather_status(
            query,
            force=True,
            location_source="system" if location else None,
            latitude=location.latitude if location else None,
            longitude=location.longitude if location else None,
        )
        if location:
            resolved = data.get("resolvedLocation") if isinstance(data.get("resolvedLocation"), dict) else {}
            persist_weather_location(
                location.latitude,
                location.longitude,
                data.get("location"),
                source="system",
                query=query,
                location_id=data.get("locationId"),
                name=resolved.get("name"),
                adm1=resolved.get("adm1"),
            )
        return data
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@api.get("/api/weather/locations/search")
def search_weather_locations(q: str = "") -> dict:
    query = str(q or "").strip()
    if not query:
        return {"locations": []}
    try:
        return {"locations": qweather_search_locations(query)}
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=f"城市搜索失败：{error}") from error


@api.post("/api/weather/location/manual")
def set_manual_weather_location(location: ManualWeatherLocation) -> dict:
    location_id = str(location.locationId or "").strip()
    if not location_id:
        raise HTTPException(status_code=422, detail="LocationID 不能为空")
    display_location = ", ".join(
        part for part in [str(location.name or "").strip(), str(location.adm1 or "").strip()]
        if part
    ) or location_id
    try:
        data = weather_status(
            location_id,
            force=True,
            display_location=display_location,
            location_source="manual",
            latitude=location.latitude,
            longitude=location.longitude,
        )
        persist_weather_location(
            location.latitude,
            location.longitude,
            display_location,
            source="manual",
            query=location_id,
            location_id=location_id,
            name=location.name,
            adm1=location.adm1,
        )
        return data
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


@api.get("/api/weather/alerts/{alert_id}")
def get_weather_alert_detail(alert_id: str) -> dict:
    try:
        return qweather_alert_detail(alert_id)
    except RuntimeError as error:
        status_code = 404 if "不存在" in str(error) or "失效" in str(error) else 400
        raise HTTPException(status_code=status_code, detail=str(error)) from error


@api.get("/api/mail/settings")
def get_mail_settings() -> dict:
    return mail_settings()


@api.post("/api/mail/connect")
def connect_mail() -> dict:
    try:
        return connect_qq_mail()
    except RuntimeError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@api.get("/api/mail/outline")
def get_mail_outline() -> dict:
    return mail_outline()


@api.post("/api/mail/refresh")
def refresh_mail_outline() -> dict:
    return mail_outline(force=True)


@api.post("/api/mail/messages/{uid}/read")
def read_mail_message_detail(uid: str) -> dict:
    try:
        return read_mail_message(uid, mark_read=True)
    except RuntimeError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@api.get("/api/mail/messages/{uid}")
def get_mail_message_detail(uid: str) -> dict:
    try:
        return read_mail_message(uid, mark_read=False)
    except RuntimeError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@api.get("/api/notifications")
def get_notifications(limit: int = 50) -> dict:
    return notification_summary(limit)


@api.get("/api/notifications/digest-records")
def get_notification_digest_records(limit: int = 20) -> dict:
    return notification_digest_records(limit)


@api.post("/api/notifications")
def create_notification(payload: NotificationPayload) -> dict:
    return push_notification(payload)


@api.post("/api/notifications/digest-records")
def create_notification_digest_record(payload: NotificationDigestRecordPayload) -> dict:
    return persist_notification_digest_record(payload)


@api.post("/api/notifications/{notification_id}/read")
def mark_notification_as_read(notification_id: str) -> dict:
    return mark_notification_read(notification_id)


@api.post("/api/notifications/read-many")
def mark_development_notifications_as_read(payload: NotificationReadManyPayload) -> dict:
    try:
        return mark_development_notifications_read(payload.ids)
    except RuntimeError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@api.post("/api/notifications/read-all")
def mark_notifications_as_read() -> dict:
    return mark_all_notifications_read()


@api.delete("/api/notifications/read")
def delete_read_notifications() -> dict:
    return clear_read_notifications()


@api.delete("/api/notifications")
def delete_notifications() -> dict:
    return clear_notifications()


if __name__ == "__main__":
    uvicorn.run(
        api,
        host="127.0.0.1",
        port=8765,
        use_colors=True,
        log_config=LOG_CONFIG,
    )
