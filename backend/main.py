import json
import os
import sqlite3
import time
from contextlib import closing
from calendar import monthrange
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware


DATABASE_PATH = Path(__file__).with_name("winplate.db")
GITHUB_API_URL = "https://api.github.com"
GITHUB_USERNAME = os.getenv("WINPLATE_GITHUB_USERNAME", "kibuouo")
GITHUB_CACHE_SECONDS = 300
_github_cache: tuple[float, dict] | None = None

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
}

api = FastAPI(title="WinPlate API", version="0.1.0")
api.add_middleware(
    CORSMiddleware,
    allow_origins=["null"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

def github_token() -> str | None:
    token = os.getenv("GITHUB_TOKEN")
    if token or os.name != "nt":
        return token
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            value, _ = winreg.QueryValueEx(key, "GITHUB_TOKEN")
            return value if isinstance(value, str) and value else None
    except (ImportError, FileNotFoundError, OSError):
        return None


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
        with urlopen(request, timeout=10) as response:
            return json.load(response)
    except HTTPError as error:
        detail = f"GitHub API returned HTTP {error.code}"
        if error.code == 403:
            detail += "; set GITHUB_TOKEN to increase the rate limit"
        raise RuntimeError(detail) from error
    except (URLError, TimeoutError) as error:
        raise RuntimeError(f"GitHub API unavailable: {error}") from error


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


def build_github_status(username: str) -> dict:
    encoded_username = quote(username, safe="")
    profile = github_request(f"/users/{encoded_username}")
    repositories = github_request(
        f"/users/{encoded_username}/repos?sort=pushed&direction=desc&per_page=100"
    )
    events = github_request(f"/users/{encoded_username}/events/public?per_page=100")

    if not isinstance(profile, dict) or not isinstance(repositories, list) or not isinstance(events, list):
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

    for event in events:
        try:
            created_at = datetime.fromisoformat(event["created_at"].replace("Z", "+00:00"))
        except (KeyError, TypeError, ValueError):
            continue
        days_ago = (now.date() - created_at.date()).days
        if 0 <= days_ago < 30:
            daily_counts[29 - days_ago] += 1
        key = month_key(created_at)
        if key in monthly_counts:
            monthly_counts[key][created_at.day - 1] += 1
            if event.get("type") == "PushEvent":
                monthly_commits[key] += len(event.get("payload", {}).get("commits", []))

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


def github_status(force: bool = False) -> dict:
    global _github_cache
    now = time.monotonic()
    if not force and _github_cache and now - _github_cache[0] < GITHUB_CACHE_SECONDS:
        return _github_cache[1]
    data = build_github_status(GITHUB_USERNAME)
    _github_cache = (now, data)
    return data


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
    try:
        result["github"] = github_status()
    except RuntimeError as error:
        result["github"] = {
            "source": "unavailable",
            "name": GITHUB_USERNAME,
            "username": f"@{GITHUB_USERNAME}",
            "profileUrl": f"https://github.com/{GITHUB_USERNAME}",
            "error": str(error),
        }
    return result


@api.post("/api/github/refresh")
def refresh_github() -> dict:
    try:
        return github_status(force=True)
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


if __name__ == "__main__":
    uvicorn.run(api, host="127.0.0.1", port=8765)
