from __future__ import annotations

import json
import sys
from functools import lru_cache
from pathlib import Path


TAXONOMY_FILENAME = "notification-taxonomy.v1.json"


def _taxonomy_path() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) / "winplate_shared" / TAXONOMY_FILENAME
    return Path(__file__).resolve().parents[3] / "packages" / "shared-types" / TAXONOMY_FILENAME


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
