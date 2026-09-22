import sqlite3
import tempfile
import unittest
from pathlib import Path

from winplate_local_api import database
from winplate_local_api.database import CURRENT_SCHEMA_VERSION, migrate_schema


class DatabaseMigrationTests(unittest.TestCase):
    def connect(self, directory: str) -> sqlite3.Connection:
        connection = sqlite3.connect(Path(directory) / "winplate.db")
        connection.row_factory = sqlite3.Row
        return connection

    def schema_version(self, connection: sqlite3.Connection) -> int:
        row = connection.execute(
            "SELECT value FROM schema_meta WHERE key = 'schema_version'"
        ).fetchone()
        return int(row[0])

    def test_fresh_database_runs_all_migrations(self):
        with tempfile.TemporaryDirectory() as directory:
            connection = self.connect(directory)
            try:
                self.assertEqual(migrate_schema(connection), CURRENT_SCHEMA_VERSION)
                self.assertEqual(self.schema_version(connection), CURRENT_SCHEMA_VERSION)
                tables = {
                    row["name"]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    )
                }
                self.assertTrue(
                    {
                        "schema_meta",
                        "status_modules",
                        "qweather_usage",
                        "qweather_usage_daily",
                        "notifications",
                        "notification_imports",
                        "mail_outline_cache",
                    }.issubset(tables)
                )
                columns = {
                    row["name"]
                    for row in connection.execute("PRAGMA table_info(notifications)")
                }
                self.assertIn("metadata", columns)
            finally:
                connection.close()

    def test_legacy_database_preserves_rows_while_migrating_to_v2(self):
        with tempfile.TemporaryDirectory() as directory:
            connection = self.connect(directory)
            connection.executescript(
                """
                CREATE TABLE status_modules (
                    module TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE notifications (
                    id TEXT PRIMARY KEY,
                    source TEXT NOT NULL,
                    level TEXT NOT NULL,
                    title TEXT NOT NULL,
                    message TEXT NOT NULL DEFAULT '',
                    unread INTEGER NOT NULL DEFAULT 1,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    external_url TEXT
                );
                INSERT INTO notifications
                    (id, source, level, title, created_at, updated_at)
                VALUES ('legacy-1', 'system', 'info', 'Legacy', 1, 1);
                """
            )
            connection.commit()
            try:
                migrate_schema(connection)
                row = connection.execute(
                    "SELECT title, metadata FROM notifications WHERE id = 'legacy-1'"
                ).fetchone()
                self.assertEqual((row["title"], row["metadata"]), ("Legacy", "{}"))
                self.assertEqual(self.schema_version(connection), CURRENT_SCHEMA_VERSION)
                indexes = {
                    row["name"]
                    for row in connection.execute("PRAGMA index_list(notifications)")
                }
                self.assertIn("idx_notifications_unread_created", indexes)
            finally:
                connection.close()

    def test_repeated_migration_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            connection = self.connect(directory)
            try:
                self.assertEqual(migrate_schema(connection), CURRENT_SCHEMA_VERSION)
                self.assertEqual(migrate_schema(connection), CURRENT_SCHEMA_VERSION)
                self.assertEqual(self.schema_version(connection), CURRENT_SCHEMA_VERSION)
            finally:
                connection.close()

    def test_future_schema_version_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            connection = self.connect(directory)
            connection.execute(
                "CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
            )
            connection.execute(
                "INSERT INTO schema_meta (key, value) VALUES ('schema_version', '99')"
            )
            connection.commit()
            try:
                with self.assertRaisesRegex(RuntimeError, "newer than this application"):
                    migrate_schema(connection)
                self.assertEqual(self.schema_version(connection), 99)
            finally:
                connection.close()

    def test_failed_migration_rolls_back_schema_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            connection = self.connect(directory)
            original_migration = database.MIGRATIONS[2]

            def fail_migration(active: sqlite3.Connection) -> None:
                active.execute("CREATE TABLE migration_probe (value TEXT)")
                raise RuntimeError("migration failed")

            database.MIGRATIONS[2] = fail_migration
            try:
                with self.assertRaisesRegex(RuntimeError, "migration failed"):
                    migrate_schema(connection)
                tables = {
                    row["name"]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    )
                }
                self.assertNotIn("schema_meta", tables)
                self.assertNotIn("migration_probe", tables)
            finally:
                database.MIGRATIONS[2] = original_migration
                connection.close()


if __name__ == "__main__":
    unittest.main()
