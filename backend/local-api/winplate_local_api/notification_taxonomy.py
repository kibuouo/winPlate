from __future__ import annotations

import json
import re
import sys
from functools import lru_cache
from pathlib import Path


TAXONOMY_FILENAME = "notification-taxonomy.v1.json"
SOURCE_TAXONOMY_PATH = Path(__file__).resolve().parents[3] / "packages" / "shared-types" / TAXONOMY_FILENAME


def _taxonomy_path() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) / "winplate_shared" / TAXONOMY_FILENAME
    return SOURCE_TAXONOMY_PATH


@lru_cache(maxsize=1)
def load_taxonomy() -> dict:
    with _taxonomy_path().open("r", encoding="utf-8") as taxonomy_file:
        value = json.load(taxonomy_file)
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise RuntimeError("notification taxonomy v1 is invalid")
    return value


def normalize_source(source: str) -> str:
    value = str(source or "").strip().lower()
    taxonomy = load_taxonomy()
    aliases = taxonomy.get("sourceAliases", {})
    return str(aliases.get(value, taxonomy.get("unknownSource", "external")))


def normalize_level(level: str) -> str:
    value = str(level or "info").strip().lower()
    levels = load_taxonomy().get("levels", [])
    return value if value in levels else "info"


def _weather() -> dict:
    weather = load_taxonomy().get("weather") or {}
    return weather if isinstance(weather, dict) else {}


@lru_cache(maxsize=1)
def _alert_color_alias_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for color, aliases in (_weather().get("alertColors") or {}).items():
        canonical = str(color).strip().lower()
        mapping[canonical] = canonical
        if not isinstance(aliases, list):
            continue
        for alias in aliases:
            mapping[str(alias).strip().lower()] = canonical
    return mapping


@lru_cache(maxsize=1)
def _title_cue_patterns() -> tuple[tuple[str, re.Pattern[str]], ...]:
    cues = _weather().get("titleCues") or {}
    patterns: list[tuple[str, re.Pattern[str]]] = []
    for color in ("red", "yellow", "blue", "green"):
        values = cues.get(color) if isinstance(cues, dict) else None
        if not isinstance(values, list) or not values:
            continue
        source = "|".join(re.escape(str(value)) for value in values if str(value).strip())
        if source:
            patterns.append((color, re.compile(source, re.I)))
    return tuple(patterns)


def canonical_alert_color(value: str | None) -> str | None:
    token = str(value or "").strip().lower()
    if not token:
        return None
    return _alert_color_alias_map().get(token)


def weather_storage_level(color: str | None) -> str | None:
    levels = _weather().get("alertColorLevels") or {}
    value = levels.get(color) if color else None
    return str(value) if value else None


def weather_display_severity(color: str | None) -> str | None:
    severities = _weather().get("alertColorSeverities") or {}
    value = severities.get(color) if color else None
    return str(value) if value else None


def weather_color_from_title(content: str) -> str | None:
    text = str(content or "")
    if not text.strip():
        return None
    for color, pattern in _title_cue_patterns():
        if pattern.search(text):
            return color
    return None


def weather_raw_color_token(payload: dict | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    color = payload.get("color")
    if isinstance(color, dict):
        code = color.get("code")
        if isinstance(code, str) and code.strip():
            return code.strip().lower()
    if isinstance(color, str) and color.strip():
        return color.strip().lower()
    severity = payload.get("severity")
    if isinstance(severity, str) and severity.strip():
        return severity.strip().lower()
    return None


def weather_alert_color(
    *,
    title: str = "",
    message: str = "",
    lifecycle: str | None = None,
    raw_color: str | None = None,
    metadata: dict | None = None,
) -> str | None:
    meta = metadata if isinstance(metadata, dict) else {}
    if str(lifecycle or meta.get("lifecycle") or "").strip().lower() == "resolved":
        return "green"
    title_color = weather_color_from_title(f"{title} {message}")
    if title_color:
        return title_color
    return canonical_alert_color(
        raw_color
        or meta.get("alertColor")
        or meta.get("severity")
        or meta.get("color")
    )
