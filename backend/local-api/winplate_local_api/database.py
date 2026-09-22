from __future__ import annotations

import sqlite3
from collections.abc import Callable


CURRENT_SCHEMA_VERSION = 2
SCHEMA_VERSION_KEY = "schema_version"
V1_TABLES = (
    "status_modules",
    "qweather_usage",
    "qweather_usage_daily",
    "notifications",
    "notification_imports",
    "mail_outline_cache",
)

Migration = Callable[[sqlite3.Connection], None]


def _create_schema_meta(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )


def _create_v1_schema(connection: sqlite3.Connection) -> None:
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
        )
        """
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


def _table_exists(connection: sqlite3.Connection, table_name: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _set_schema_version(connection: sqlite3.Connection, version: int) -> None:
    connection.execute(
        """
        INSERT INTO schema_meta (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (SCHEMA_VERSION_KEY, str(version)),
    )


def _read_schema_version(connection: sqlite3.Connection) -> int | None:
    row = connection.execute(
        "SELECT value FROM schema_meta WHERE key = ?",
        (SCHEMA_VERSION_KEY,),
    ).fetchone()
    if row is None:
        return None
    try:
        version = int(row[0])
    except (TypeError, ValueError) as error:
        raise RuntimeError("WinPlate database schema version is invalid") from error
    if version < 0:
        raise RuntimeError("WinPlate database schema version cannot be negative")
    return version


def _migrate_to_v2(connection: sqlite3.Connection) -> None:
    notification_columns = {
        row["name"] if isinstance(row, sqlite3.Row) else row[1]
        for row in connection.execute("PRAGMA table_info(notifications)")
    }
    if "metadata" not in notification_columns:
        connection.execute("ALTER TABLE notifications ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'")
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_notifications_unread_created ON notifications (unread, created_at)"
    )


MIGRATIONS: dict[int, Migration] = {
    1: _create_v1_schema,
    2: _migrate_to_v2,
}


def migrate_schema(connection: sqlite3.Connection) -> int:
    """Apply all pending SQLite migrations and return the current version."""
    connection.row_factory = sqlite3.Row
    if connection.in_transaction:
        raise RuntimeError("WinPlate database migration cannot run inside a transaction")
    connection.execute("BEGIN")
    try:
        _create_schema_meta(connection)
        current_version = _read_schema_version(connection)
        if current_version is None:
            # Databases created before schema_meta existed are either empty or
            # already contain every v1 application table. Treat the latter as
            # v1 so the v2 migration remains idempotent and repairs indexes.
            current_version = 1 if all(_table_exists(connection, table) for table in V1_TABLES) else 0
            _set_schema_version(connection, current_version)

        if current_version > CURRENT_SCHEMA_VERSION:
            raise RuntimeError(
                "WinPlate database schema is newer than this application "
                f"({current_version} > {CURRENT_SCHEMA_VERSION})"
            )

        for version in range(current_version + 1, CURRENT_SCHEMA_VERSION + 1):
            migration = MIGRATIONS[version]
            migration(connection)
            _set_schema_version(connection, version)
    except Exception:
        connection.rollback()
        raise
    else:
        connection.commit()

    return CURRENT_SCHEMA_VERSION
