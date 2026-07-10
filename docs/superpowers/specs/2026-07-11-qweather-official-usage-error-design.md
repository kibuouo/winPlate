# QWeather Official Usage Error Design

## Problem

Refreshing official QWeather usage calls `GET /metrics/v1/stats` with the configured credential filter. When QWeather returns HTTP 400, the backend discards the response's `error.detail`, converts the failure to a generic 502, and leaves the Electron renderer with no actionable cause.

The configured API host is the user's dedicated `qweatherapi.com` host, so this change does not alter host selection or fall back to a legacy shared host.

## Design

Keep the current credential-scoped request and its response semantics. Extend `qweather_jwt_request` so every QWeather HTTP error includes a safely decoded, non-empty `error.detail` in the raised message. Preserve the existing tailored message for HTTP 401 and 403. For HTTP 400, add a concise hint to verify the credential's Console API traffic-statistics privilege when QWeather supplies no useful detail.

Do not retry without the `credential` query parameter. An unfiltered retry would silently change the displayed metric from credential usage to account-wide usage.

## Data Flow

1. Electron invokes `POST /api/weather/usage/official` on the local backend.
2. The backend requests QWeather `/metrics/v1/stats?credential=<credential-id>` using JWT authentication.
3. On success, the existing aggregation and response shape remain unchanged.
4. On a QWeather HTTP error, the backend decodes the JSON or gzip JSON error body and raises an actionable message.
5. The FastAPI route continues returning that message as its 502 `detail`; Electron continues showing the backend detail without API changes.

## Testing

Add a focused backend unit test that simulates a QWeather HTTP 400 JSON response and asserts that the official error detail reaches the raised `RuntimeError`. Run that test first to verify it fails against the current implementation, then implement the minimal change and run the complete backend test suite.

## Non-goals

- Changing QWeather credentials, permissions, API host, or JWT generation.
- Falling back to account-wide statistics.
- Changing Electron IPC or renderer behavior.
