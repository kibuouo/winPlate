# GitHub Contribution Activity Drilldown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a two-column GitHub activity view whose right panel shows monthly repository totals by default and exact per-day repository totals after a calendar date is selected.

**Architecture:** Extend the local API with one validated contribution-detail endpoint backed by GitHub GraphQL and cached-calendar fallback. Carry that endpoint through the existing main-process IPC and preload boundaries, then add renderer state and focused DOM updates for date selection while preserving the current calendar and refresh flow.

**Tech Stack:** Python 3/FastAPI, GitHub GraphQL API, Electron 40, vanilla JavaScript, CSS, Python `unittest`, Node.js test runner.

## Global Constraints

- Never infer a repository when GitHub has not returned repository-level detail.
- Without a GitHub Token or after a detail-query failure, return the reliable cached contribution total with `detailsAvailable: false`.
- Ignore stale renderer responses when the selected date changes.
- Switching month or refreshing GitHub clears the selected date and returns to monthly mode.
- Preserve unrelated working-tree changes.

---

### Task 1: Add validated backend contribution-detail ranges

**Files:**
- Modify: `backend/local-api/winplate_local_api/main.py`
- Test: `backend/local-api/tests/test_app.py`

**Interfaces:**
- Produces: `github_contribution_detail(username: str, *, date_text: str | None, month_text: str | None) -> dict`.
- Produces: `GET /api/github/contributions?date=YYYY-MM-DD` or `?month=YYYY-MM`.
- Response: `{ rangeType, rangeKey, label, totalCount, repositoryCount, repositories, detailsAvailable, message }` where repositories contain `{ nameWithOwner, url, count }`.

- [ ] **Step 1: Write failing backend tests**

Add tests that assert: exactly one range parameter is required; invalid dates/months return 400; GraphQL variables use inclusive start and exclusive next-boundary ISO values; repository nodes map and sort by descending count; no-token mode uses matching cached `contributionMonths` counts without repository guesses; GraphQL failure returns the same fallback shape.

- [ ] **Step 2: Run backend tests to verify RED**

Run: `npm run backend:test`

Expected: FAIL because `github_contribution_detail` and `/api/github/contributions` do not exist.

- [ ] **Step 3: Implement range parsing and GraphQL mapping**

Add strict helpers that parse `YYYY-MM-DD` with `date.fromisoformat`, parse `YYYY-MM` with `datetime.strptime`, derive UTC start/end boundaries, and execute:

```graphql
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      commitContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner url }
        contributions { totalCount }
      }
    }
  }
}
```

Normalize non-negative counts, omit malformed repositories, sort descending, and compute repositoryCount from returned repositories.

- [ ] **Step 4: Implement reliable fallback and route**

Read the requested day/month total from `cached_github_status()["contributionMonths"]`. Return no repositories, `detailsAvailable: false`, and `Repository details require a GitHub Token.` when no token exists; return `Repository details are temporarily unavailable.` after a GraphQL error. Register the GET route with mutually exclusive optional query parameters and HTTP 400 for invalid ranges.

- [ ] **Step 5: Run backend tests to verify GREEN**

Run: `npm run backend:test`

Expected: all backend tests PASS.

### Task 2: Carry contribution details through Electron security boundaries

**Files:**
- Modify: `apps/windows-electron/src/main/main.js`
- Modify: `apps/windows-electron/src/preload/preload.js`
- Modify: `apps/windows-electron/src/main/integrationSecurity.test.js`
- Modify: `apps/windows-electron/src/renderer/security.test.js`

**Interfaces:**
- Consumes: backend `GET /api/github/contributions` response from Task 1.
- Produces: IPC `github:get-contributions` and preload `getGithubContributions(range)` where range is exactly `{ date: "YYYY-MM-DD" }` or `{ month: "YYYY-MM" }`.

- [ ] **Step 1: Write failing IPC and preload tests**

Assert the preload exposes only `getGithubContributions(range)`, invokes `github:get-contributions`, and the main process accepts only the live main-window sender. Assert the main process validates the range key/value before constructing a URL and uses `fetchWithTimeout` plus `readJsonWithTimeout`.

- [ ] **Step 2: Run security tests to verify RED**

Run: `node --test apps/windows-electron/src/main/integrationSecurity.test.js apps/windows-electron/src/renderer/security.test.js`

Expected: FAIL on the absent bridge and handler.

- [ ] **Step 3: Implement the narrow bridge and handler**

Expose:

```js
getGithubContributions: (range) => ipcRenderer.invoke("github:get-contributions", range)
```

In the main handler, call `requireMainWindowSender(event)`, accept only one key matching `/^\d{4}-\d{2}-\d{2}$/` or `/^\d{4}-\d{2}$/`, encode the query with `URLSearchParams`, reject invalid payloads, and return parsed JSON from the local API.

- [ ] **Step 4: Run security tests to verify GREEN**

Run the Step 2 command.

Expected: both test files PASS.

### Task 3: Build renderer selection state and activity panel

**Files:**
- Modify: `apps/windows-electron/src/renderer/app.js`
- Test: `apps/windows-electron/src/renderer/security.test.js`

**Interfaces:**
- Consumes: `window.winplate.getGithubContributions({ date })` and `({ month })` from Task 2.
- Produces: `selectedContributionDate`, `githubContributionDetails`, `githubContributionDetailCache`, `githubContributionRequestId`.
- Produces: `renderGithubContributionActivity(detail, fallback)` and `loadGithubContributionActivity(range)`.

- [ ] **Step 1: Write failing renderer contract tests**

Assert calendar buttons include `data-contribution-date` and `aria-pressed`; the activity panel has `#github-contribution-activity`; click delegation toggles the same date off; month navigation clears selection; request-id equality gates DOM updates; GitHub refresh clears the detail cache.

- [ ] **Step 2: Run renderer tests to verify RED**

Run: `node --test apps/windows-electron/src/renderer/security.test.js`

Expected: FAIL because selection state and the activity panel loader are absent.

- [ ] **Step 3: Implement selectable calendar days**

Render active dates as semantic `<button>` elements with `data-contribution-date="YYYY-MM-DD"`, `aria-pressed`, existing tooltip data, and contribution intensity classes. Keep adjacent-month cells non-interactive.

- [ ] **Step 4: Implement activity rendering states**

Render the reliable monthly or daily total from current calendar counts while backend details are loading, without attributing that number to a repository. Replace it with backend repository rows when available. For `detailsAvailable: false`, show the reliable total and message without any repository row. Render zero, loading, error/retry, monthly, and daily headings without changing the calendar DOM.

- [ ] **Step 5: Implement selection, cancellation, cache, and stale-response isolation**

On date click, toggle `selectedContributionDate`; increment `githubContributionRequestId`; use cache key `date:YYYY-MM-DD` or `month:YYYY-MM`; call the preload bridge; update only when the captured id equals the latest id. On month change, TODAY, or GitHub refresh, clear date selection and render/request the selected month summary.

- [ ] **Step 6: Run renderer tests to verify GREEN**

Run the Step 2 command.

Expected: all renderer tests PASS.

### Task 4: Create the two-column responsive layout and verify end to end

**Files:**
- Modify: `apps/windows-electron/src/renderer/styles.css`
- Modify: `apps/windows-electron/src/renderer/security.test.js`

**Interfaces:**
- Consumes: `.github-activity-split`, `.github-calendar-pane`, `.github-contribution-activity`, selected date buttons, and activity repository rows from Task 3.
- Produces: 55%/45% desktop layout and stacked responsive layout.

- [ ] **Step 1: Write failing CSS contract tests**

Assert `.github-activity-split` uses `grid-template-columns: minmax(0, 1.1fr) minmax(300px, .9fr)`, selected days have a distinct focus/selection treatment, the right pane has its own divider/scroll boundary, and the existing narrow breakpoint switches to one column.

- [ ] **Step 2: Run renderer tests to verify RED**

Run: `node --test apps/windows-electron/src/renderer/security.test.js`

Expected: FAIL on missing two-column styles.

- [ ] **Step 3: Implement desktop and responsive styles**

Place month controls and calendar statistics inside the left pane. Give the right pane a left divider, compact timeline marker, repository link/count rows, loading skeleton, and fallback message. At `max-width: 900px`, switch to one column, replace the left divider with a top border, and keep date controls at least 30px square.

- [ ] **Step 4: Run all automated verification**

Run: `npm run backend:test`

Run: `npm run check`

Expected: both commands PASS with zero failures.

- [ ] **Step 5: Verify in Electron**

Reload or start WinPlate, open GitHub, and verify monthly default, contributed-day detail, zero-day state, same-day deselection, month reset, refresh reset, no overlap at wide width, and stacked layout at narrow width. Capture `docs/qa/2026-07-11-github-contribution-drilldown-current.png` only if the user is not actively controlling the window.
