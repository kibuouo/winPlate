from __future__ import annotations

import os
from collections.abc import Mapping

import uvicorn

from winplate_local_api.main import LOG_CONFIG, api


def resolve_port(environment: Mapping[str, str] = os.environ) -> int:
    raw_port = environment.get("WINPLATE_BACKEND_PORT", "8765").strip()
    try:
        port = int(raw_port)
    except ValueError as error:
        raise ValueError("WINPLATE_BACKEND_PORT must be an integer") from error
    if not 1 <= port <= 65535:
        raise ValueError("WINPLATE_BACKEND_PORT must be between 1 and 65535")
    return port


def main() -> None:
    uvicorn.run(
        api,
        host="127.0.0.1",
        port=resolve_port(),
        use_colors=True,
        log_config=LOG_CONFIG,
    )


if __name__ == "__main__":
    main()
