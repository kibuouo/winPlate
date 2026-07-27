from __future__ import annotations

import json
import re
import sqlite3
from contextlib import closing
from typing import Callable, Iterable


class NotificationManager:
    """Single persistence and state boundary for every notification source."""

    def __init__(self, connect: Callable[[], sqlite3.Connection], now_ms: Callable[[], int]):
        self._connect = connect
        self._now_ms = now_ms

    @staticmethod
    def normalize_source(source: str) -> str:
        value = re.sub(r"[^a-z0-9_-]+", "-", str(source or "").strip().lower()).strip("-")
        return value[:32] or "external"

    @staticmethod
    def normalize_level(level: str) -> str:
        value = str(level or "info").strip().lower()
        return value if value in {"info", "success", "warning", "critical"} else "info"

    @staticmethod
    def row_to_item(row: sqlite3.Row) -> dict:
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

    def publish(
        self,
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
        connection: sqlite3.Connection | None = None,
    ) -> dict:
        normalized_source = self.normalize_source(source)
        safe_title = str(title or "").strip()[:180] or "WinPlate 通知"
        safe_message = str(message or "").strip()[:360]
        safe_level = self.normalize_level(level)
        safe_metadata = metadata if isinstance(metadata, dict) else {}
        metadata_json = json.dumps(safe_metadata, ensure_ascii=False, separators=(",", ":"))
        now = self._now_ms()
        created = int(created_at or now)
        insert_unread = 1 if unread is None else int(bool(unread))
        unread_update_sql = "" if unread is None else ", unread = excluded.unread"

        def execute(active: sqlite3.Connection) -> dict:
            active.execute(
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
            row = active.execute(
                """
                SELECT id, source, level, title, message, unread, created_at, updated_at, external_url, metadata
                FROM notifications
                WHERE id = ?
                """,
                (notification_id,),
            ).fetchone()
            return self.row_to_item(row)

        if connection is not None:
            return execute(connection)
        with closing(self._connect()) as active:
            item = execute(active)
            active.commit()
            return item

    def remove(self, notification_id: str, *, connection: sqlite3.Connection | None = None) -> None:
        def execute(active: sqlite3.Connection) -> None:
            active.execute("DELETE FROM notifications WHERE id = ?", (notification_id,))

        if connection is not None:
            execute(connection)
            return
        with closing(self._connect()) as active:
            execute(active)
            active.commit()

    def summary(self, limit: int = 50) -> dict:
        safe_limit = max(1, min(50, int(limit or 50)))
        with closing(self._connect()) as connection:
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
        items = [self.row_to_item(row) for row in rows]
        latest = next((item for item in items if item["unread"]), items[0] if items else None)
        return {
            "items": items,
            "latest": latest,
            "unreadCount": int(unread_count),
            "updatedAt": self._now_ms(),
        }

    def set_unread(self, notification_id: str, unread: bool) -> None:
        with closing(self._connect()) as connection:
            connection.execute(
                "UPDATE notifications SET unread = ?, updated_at = ? WHERE id = ?",
                (1 if unread else 0, self._now_ms(), notification_id),
            )
            connection.commit()

    def mark_read(self, notification_id: str) -> None:
        self.set_unread(notification_id, False)

    def mark_many_read(self, notification_ids: Iterable[str], *, allowed_sources: set[str] | None = None) -> None:
        ids = [str(value or "").strip() for value in notification_ids]
        if not ids or any(not value for value in ids) or len(set(ids)) != len(ids):
            raise RuntimeError("通知标识无效")
        placeholders = ", ".join("?" for _ in ids)
        with closing(self._connect()) as connection:
            rows = connection.execute(
                f"SELECT id, source FROM notifications WHERE id IN ({placeholders})",
                ids,
            ).fetchall()
            if len(rows) != len(ids):
                raise RuntimeError("通知不存在")
            if allowed_sources and any(row["source"] not in allowed_sources for row in rows):
                raise RuntimeError("通知来源不允许批量操作")
            connection.execute(
                f"UPDATE notifications SET unread = 0, updated_at = ? WHERE id IN ({placeholders})",
                [self._now_ms(), *ids],
            )
            connection.commit()

    def unread_ids(self, *, source: str | None = None) -> list[str]:
        query = "SELECT id FROM notifications WHERE unread = 1"
        params: tuple[str, ...] = ()
        if source:
            query += " AND source = ?"
            params = (self.normalize_source(source),)
        with closing(self._connect()) as connection:
            return [row["id"] for row in connection.execute(query, params).fetchall()]

    def mark_all_read(self) -> None:
        with closing(self._connect()) as connection:
            connection.execute(
                "UPDATE notifications SET unread = 0, updated_at = ? WHERE unread = 1",
                (self._now_ms(),),
            )
            connection.commit()

    def clear(self) -> None:
        with closing(self._connect()) as connection:
            connection.execute("DELETE FROM notifications")
            connection.commit()

    def clear_read(self) -> None:
        with closing(self._connect()) as connection:
            connection.execute("DELETE FROM notifications WHERE unread = 0")
            connection.commit()

    @staticmethod
    def was_imported(connection: sqlite3.Connection, import_id: str) -> bool:
        return connection.execute(
            "SELECT 1 FROM notification_imports WHERE id = ?",
            (import_id,),
        ).fetchone() is not None

    @staticmethod
    def record_import(
        connection: sqlite3.Connection,
        *,
        import_id: str,
        source: str,
        imported_at: int,
    ) -> None:
        connection.execute(
            "INSERT OR IGNORE INTO notification_imports (id, source, imported_at) VALUES (?, ?, ?)",
            (import_id, source, imported_at),
        )
