# QWeather Official Usage Error Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve QWeather's official HTTP error detail so a failed credential-scoped usage refresh tells the user what must be corrected.

**Architecture:** Keep the existing Electron IPC, FastAPI route, credential filter, and successful response unchanged. Modify the shared QWeather JWT request error path to append decoded `error.detail` for every HTTP status and provide a Console API privilege hint for an otherwise-detail-free HTTP 400.

**Tech Stack:** Python 3, `urllib`, FastAPI, `unittest`, `unittest.mock`

## Global Constraints

- Keep `/metrics/v1/stats?credential=<credential-id>` and credential-scoped usage semantics.
- Do not retry without the `credential` query parameter.
- Do not change Electron IPC or renderer behavior.
- Preserve the existing tailored HTTP 401 and 403 credential message.

---

### Task 1: Preserve QWeather HTTP Error Detail

**Files:**
- Modify: `backend/local-api/winplate_local_api/main.py:1460-1474`
- Test: `backend/local-api/tests/test_app.py`

**Interfaces:**
- Consumes: `qweather_jwt_request(path: str, params: dict[str, str] | None = None, timeout: int = 10) -> dict`
- Produces: the same function signature, with actionable `RuntimeError` messages for QWeather HTTP failures

- [ ] **Step 1: Write the failing test**

Add this test to the existing QWeather test group:

```python
def test_qweather_jwt_request_preserves_http_400_detail(self):
    settings = lambda name, default=None: {
        "QWEATHER_PROJECT_ID": "project",
        "QWEATHER_CREDENTIAL_ID": "credential",
        "QWEATHER_PRIVATE_KEY": "private-key",
        "QWEATHER_API_HOST": "example.com",
    }.get(name, default)
    error = HTTPError(
        "https://example.com/metrics/v1/stats?credential=credential",
        400,
        "Bad Request",
        {"Content-Encoding": ""},
        BytesIO(json.dumps({
            "error": {"detail": "credential traffic stats permission is disabled"},
        }).encode()),
    )
    with (
        patch.object(main, "environment_setting", side_effect=settings),
        patch.object(main.jwt, "encode", return_value="token"),
        patch.object(main, "record_qweather_request"),
        patch.object(main, "urlopen", side_effect=error),
    ):
        with self.assertRaisesRegex(RuntimeError, "credential traffic stats permission is disabled"):
            main.qweather_jwt_request("/metrics/v1/stats", {"credential": "credential"})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run `node scripts/venvPython.js -m unittest tests.test_app.AppTest.test_qweather_jwt_request_preserves_http_400_detail`.

Expected: FAIL because the current exception is only `QWeather 接口返回 HTTP 400`.

- [ ] **Step 3: Implement the minimal error-message change**

After the existing 401/403 branch, replace the generic raise with:

```python
message = f"QWeather 接口返回 HTTP {error.code}"
if detail:
    message = f"{message}: {detail}"
elif error.code == 400:
    message = f"{message}，请检查该凭据的 Console API 请求量统计权限"
raise RuntimeError(message) from error
```

- [ ] **Step 4: Run focused and backend regression tests**

Run:

```powershell
node scripts/venvPython.js -m unittest tests.test_app.AppTest.test_qweather_jwt_request_preserves_http_400_detail
npm run backend:test
```

Expected: the focused test passes and the full backend suite reports `OK`.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
git diff --check
git diff -- backend/local-api/winplate_local_api/main.py backend/local-api/tests/test_app.py
git add backend/local-api/winplate_local_api/main.py backend/local-api/tests/test_app.py
git commit -m "fix: preserve QWeather usage error detail"
```

Expected: no whitespace errors; the diff contains only the focused test and HTTP error-message change.
