from copy import deepcopy


MODULES = (
    {"id": "github", "title": "GitHub", "service": "github", "routes": ("/api/status", "/api/github/refresh")},
    {"id": "codex", "title": "Codex", "service": "electron", "routes": ()},
    {"id": "notifications", "title": "Notifications", "service": "notifications", "routes": ("/api/notifications",)},
    {"id": "mail", "title": "Mail", "service": "mail", "routes": ("/api/mail/outline", "/api/mail/refresh")},
    {"id": "weather", "title": "QWeather", "service": "weather", "routes": ("/api/status", "/api/weather/refresh")},
    {"id": "heart", "title": "Heart", "service": "status", "routes": ("/api/status",)},
    {"id": "network", "title": "Network", "service": "electron", "routes": ()},
)


def public_modules() -> list[dict]:
    return [
        {**deepcopy(module), "routes": list(module["routes"])}
        for module in MODULES
    ]


def validate_modules() -> None:
    ids = [module["id"] for module in MODULES]
    if len(ids) != len(set(ids)):
        raise RuntimeError("backend module ids must be unique")
    for module in MODULES:
        if not module["title"] or not module["service"]:
            raise RuntimeError(f"backend module {module['id']} is incomplete")


validate_modules()
