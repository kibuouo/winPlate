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
