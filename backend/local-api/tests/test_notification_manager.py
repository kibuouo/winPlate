import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from winplate_local_api.notification_manager import NotificationManager


class NotificationManagerTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "notifications.db"
        self.now = 1_780_000_000_000

        with closing(self.connect()) as connection:
            connection.executescript(
                """
                CREATE TABLE notifications (
                    id TEXT PRIMARY KEY,
                    source TEXT NOT NULL,
                    level TEXT NOT NULL,
                    title TEXT NOT NULL,
                    message TEXT,
                    unread INTEGER NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    external_url TEXT,
                    metadata TEXT
                );
                CREATE TABLE notification_imports (
                    id TEXT PRIMARY KEY,
                    source TEXT NOT NULL,
                    imported_at INTEGER NOT NULL
                );
                """
            )
        self.manager = NotificationManager(self.connect, lambda: self.now)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def connect(self):
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def test_all_sources_publish_and_read_through_one_manager(self):
        for index, source in enumerate(("mail", "qweather", "codex", "chatgpt", "github", "system")):
            self.manager.publish(
                notification_id=f"{source}:{index}",
                source=source,
                title=f"{source} update",
                level="warning" if source == "qweather" else "info",
                created_at=self.now + index,
            )

        summary = self.manager.summary()
        self.assertEqual(summary["unreadCount"], 6)
        self.assertEqual({item["source"] for item in summary["items"]}, {
            "mail", "qweather", "codex", "chatgpt", "github", "system"
        })

    def test_source_aliases_match_the_shared_taxonomy(self):
        cases = {
            "email": "mail",
            "openai": "chatgpt",
            "weather": "qweather",
            "external": "external",
            "vendor-alerts": "external",
            "": "external",
        }
        for source, expected in cases.items():
            with self.subTest(source=source):
                self.assertEqual(self.manager.normalize_source(source), expected)

    def test_publish_persists_canonical_source_values(self):
        self.manager.publish(
            notification_id="email:one",
            source="email",
            title="Mail",
        )
        self.manager.publish(
            notification_id="vendor:one",
            source="vendor-alerts",
            title="Vendor alert",
        )

        summary = self.manager.summary()
        self.assertEqual(
            {item["source"] for item in summary["items"]},
            {"mail", "external"},
        )

    def test_legacy_source_aliases_are_migrated_before_sql_filters(self):
        with closing(self.connect()) as connection:
            connection.execute(
                "INSERT INTO notifications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "legacy-email",
                    "email",
                    "info",
                    "Legacy mail",
                    "",
                    1,
                    self.now,
                    self.now,
                    None,
                    "{}",
                ),
            )
            connection.execute(
                "INSERT INTO notification_imports VALUES (?, ?, ?)",
                ("legacy-import", "openai", self.now),
            )
            connection.commit()

        self.assertEqual(self.manager.normalize_persisted_sources(), 2)
        self.assertEqual(self.manager.summary()["items"][0]["source"], "mail")
        self.assertEqual(self.manager.unread_ids(source="mail"), ["legacy-email"])
        with closing(self.connect()) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT source FROM notification_imports WHERE id = ?",
                    ("legacy-import",),
                ).fetchone()["source"],
                "chatgpt",
            )

    def test_state_changes_and_import_tracking_stay_inside_manager(self):
        self.manager.publish(
            notification_id="codex:one",
            source="codex",
            title="Done",
            unread=True,
        )
        self.manager.mark_read("codex:one")
        self.assertEqual(self.manager.summary()["unreadCount"], 0)

        with closing(self.connect()) as connection:
            self.manager.record_import(
                connection,
                import_id="toast:one",
                source="codex",
                imported_at=self.now,
            )
            connection.commit()
            self.assertTrue(self.manager.was_imported(connection, "toast:one"))

        self.manager.clear_read()
        self.assertEqual(self.manager.summary()["items"], [])


if __name__ == "__main__":
    unittest.main()
