import json
import sqlite3
from contextlib import closing
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


DATABASE_PATH = Path(__file__).with_name("winplate.db")

DEFAULT_STATUS = {
    "github": {
        "name": "kibuouo",
        "username": "@kibuouo",
        "repos": 24,
        "followers": 18,
        "project": "winplate",
    },
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
}

api = FastAPI(title="WinPlate API", version="0.1.0")
api.add_middleware(
    CORSMiddleware,
    allow_origins=["null"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


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
        for module, payload in DEFAULT_STATUS.items():
            connection.execute(
                "INSERT OR IGNORE INTO status_modules (module, payload) VALUES (?, ?)",
                (module, json.dumps(payload)),
            )
        connection.commit()


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
    return {row["module"]: json.loads(row["payload"]) for row in rows}


if __name__ == "__main__":
    uvicorn.run(api, host="127.0.0.1", port=8765)
