# Notification Center Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a master-detail notification center, source-card quick previews, and an acknowledgement modal limited to active QWeather red alerts.

**Architecture:** Persist source-specific weather metadata alongside normalized notifications, then make renderer decisions from that structured data. Keep notification-list rendering and the acknowledgement predicate in the existing notification component; retain state, event delegation, navigation, and focus management in the renderer application shell. Dashboard, QWeather, and GitHub cards reuse the normalized unread list to render an inline hover preview and navigate to the selected notification.

**Tech Stack:** Electron, vanilla JavaScript, Python/FastAPI, SQLite, Node's built-in test runner, Python unittest.

## Global Constraints

- Only a notification with `source === "qweather"`, `metadata.severity === "red"`, and active lifecycle requires acknowledgement.
- Never infer a red alert from title/body text or the generic `critical` level.
- Confirming “我已知悉” marks the notification read; close, backdrop, and Escape do not.
- Normal information, warnings, and success events remain in the in-page master-detail workspace.
- Use the existing safe notification detail/actions API; do not introduce renderer access to raw external URLs or arbitrary markup.
- Preserve keyboard access, focus restoration, and light/dark visual contrast.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/local-api/winplate_local_api/main.py` | Migrate and serialize notification metadata, and write QWeather severity/lifecycle metadata. |
| `backend/local-api/tests/test_app.py` | Exercise weather metadata persistence and the active-red versus resolved-red boundary. |
| `apps/windows-electron/src/renderer/components/notificationDigest.js` | Render the notification workspace/list and expose pure filtering, preview, and red-alert eligibility helpers. |
| `apps/windows-electron/src/renderer/app.js` | Own selection/filter/modal state, safe detail loading, keyboard and click handling, dashboard-card navigation, and tooltip rendering. |
| `apps/windows-electron/src/renderer/styles.css` | Lay out the responsive master-detail center, selected rows, inline preview, and accessible red-alert modal. |
| `apps/windows-electron/src/renderer/security.test.js` | Replace drawer expectations with master-detail, modal, and source-preview harness coverage. |

## Task 1: Preserve weather-alert metadata on normalized notifications

**Files:**
- Modify: `backend/local-api/winplate_local_api/main.py:465-476,582-637,1121-1165,1843-1906`
- Modify: `backend/local-api/tests/test_app.py:746-809`

**Interfaces:**
- Produces notification items with `metadata: dict`, including QWeather `severity`, `lifecycle`, and `riskDelta`.
- Consumed by renderer helper `isAcknowledgementRequired(notification)` in Task 3.

- [ ] **Step 1: Add failing backend tests for metadata and the red-alert boundary**

  Extend the QWeather fixture tests with these assertions and an active-red test:

  ```python
  self.assertEqual(summary["latest"]["metadata"], {
      "severity": "moderate", "lifecycle": "issued", "riskDelta": "active"
  })

  def test_qweather_active_red_alert_persists_exact_acknowledgement_metadata(self):
      # Use a temporary database and a fixture with severity="red" and no resolved status.
      result = main.qweather_alerts(22.3193, 114.1694)
      item = main.notification_summary()["latest"]
      self.assertEqual(result["alerts"][0]["level"], "critical")
      self.assertEqual(item["metadata"], {
          "severity": "red", "lifecycle": "issued", "riskDelta": "active"
      })
  ```

- [ ] **Step 2: Run the targeted backend tests and verify they fail**

  Run: `npm run backend:test`

  Expected: FAIL because notification rows have no `metadata` field.

- [ ] **Step 3: Add a backward-compatible metadata column and serialization**

  In `initialize_database`, create `metadata TEXT NOT NULL DEFAULT '{}'` for new databases, then migrate existing user databases before queries run:

  ```python
  columns = {row["name"] for row in connection.execute("PRAGMA table_info(notifications)")}
  if "metadata" not in columns:
      connection.execute("ALTER TABLE notifications ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'")
  ```

  Decode it safely in `notification_row_to_item` and add the argument to `upsert_notification`:

  ```python
  def notification_row_to_item(row: sqlite3.Row) -> dict:
      try:
          metadata = json.loads(row["metadata"] or "{}")
      except (TypeError, json.JSONDecodeError):
          metadata = {}
      return {
          "id": row["id"], "source": row["source"], "level": row["level"],
          "title": row["title"], "message": row["message"] or "",
          "unread": bool(row["unread"]), "createdAt": int(row["created_at"]),
          "updatedAt": int(row["updated_at"]), "externalUrl": row["external_url"] or None,
          "metadata": metadata if isinstance(metadata, dict) else {}
      }

  def upsert_notification(*, notification_id: str, source: str, title: str,
                          message: str = "", level: str = "info", created_at: int | None = None,
                          external_url: str | None = None, metadata: dict | None = None,
                          unread: bool | None = None) -> dict:
      safe_metadata = metadata if isinstance(metadata, dict) else {}
      metadata_json = json.dumps(safe_metadata, ensure_ascii=False, separators=(",", ":"))
      # Include metadata in both INSERT and ON CONFLICT UPDATE, then SELECT it back.
  ```

  Pass `{"severity": severity, "lifecycle": lifecycle, "riskDelta": normalized_alert["riskDelta"]}` when QWeather upserts its notification. Keep `level` mapping unchanged; it remains a presentation/priority field, not the acknowledgement trigger.

- [ ] **Step 4: Run the targeted backend tests and verify they pass**

  Run: `npm run backend:test`

  Expected: PASS; active red records `metadata.severity == "red"`, while cancelled red remains `metadata.lifecycle == "resolved"` and level `success`.

- [ ] **Step 5: Commit the backend metadata slice**

  ```bash
  git add backend/local-api/winplate_local_api/main.py backend/local-api/tests/test_app.py
  git commit -m "feat: retain weather alert metadata in notifications"
  ```

## Task 2: Replace the notification drawer with a master-detail workspace

**Files:**
- Modify: `apps/windows-electron/src/renderer/components/notificationDigest.js:30-114`
- Modify: `apps/windows-electron/src/renderer/app.js:2514-2537,3430-3716,4010-4070`
- Modify: `apps/windows-electron/src/renderer/styles.css:1657-1804`
- Modify: `apps/windows-electron/src/renderer/security.test.js:301-453,1513-1752`

**Interfaces:**
- Consumes `notificationSummary.items`, `notificationDigest`, and `window.winplate.getNotificationDetail(id)`.
- Produces `renderNotificationWorkspace(items, options)`, `filterNotificationItems(items, filters)`, and selected-row markup with `data-notification-select`.
- Task 4 relies on `selectNotification(id)` accepting an externally supplied notification id.

- [ ] **Step 1: Replace drawer-specific renderer assertions with failing workspace assertions**

  In `security.test.js`, replace the drawer contract test with checks for the new stable DOM contract:

  ```js
  assert.match(component, /function filterNotificationItems/);
  assert.match(component, /data-notification-select="\$\{escapeHtml\(item\.id\)\}"/);
  assert.match(renderer, /class="notification-workspace"/);
  assert.match(renderer, /notification-detail-empty/);
  assert.doesNotMatch(renderer, /function notificationDrawer/);
  assert.doesNotMatch(component, /notification-raw-section/);
  ```

  Update the renderer harness so it owns `notificationSelection = { id: null, loading: false, data: null, error: "" }` rather than `notificationDrawerState`, then add a test that clicks `data-notification-select="n1"`, waits for `getNotificationDetail("n1")`, and asserts the item is marked read and stays selected.

- [ ] **Step 2: Run the renderer unit file and verify the new assertions fail**

  Run: `node --test apps/windows-electron/src/renderer/security.test.js`

  Expected: FAIL because the component still emits `notification-raw-section` and the renderer still defines `notificationDrawer`.

- [ ] **Step 3: Implement pure filtering and master-list markup in the component**

  Replace `renderRawNotifications` and `renderDigestDrawerList` with a filtering helper and workspace-list renderer. Keep all untrusted content flowing through `escapeHtml`:

  ```js
  function filterNotificationItems(items = [], filters = {}) {
    const source = filters.source || "all";
    const state = filters.state || "all";
    return (Array.isArray(items) ? items : []).filter((item) =>
      (source === "all" || item.source === source)
      && (state === "all" || (state === "unread" ? item.unread : !item.unread))
    );
  }

  function renderNotificationList(items, { selectedId, sourceLabel, levelLabel, relativeTime } = {}) {
    return `<div class="notification-master-list">${items.map((item) => `
      <button class="notification-master-row ${String(item.id) === String(selectedId) ? "selected" : ""}"
        type="button" aria-pressed="${String(item.id) === String(selectedId)}"
        data-notification-select="${escapeHtml(item.id)}">
        <span>${escapeHtml(sourceLabel?.(item.source) || item.source || "WinPlate")}</span>
        <strong>${escapeHtml(item.title || "通知")}</strong>
        <small>${escapeHtml(levelLabel?.(item.level) || item.level || "信息")} · ${escapeHtml(relativeTime?.(item.createdAt) || "")}</small>
      </button>`).join("")}</div>`;
  }
  ```

  Export both helpers through `WinPlateNotificationDigest`.

- [ ] **Step 4: Move selection, detail retry, and read marking into the page state**

  In `app.js`, replace drawer state with `notificationFilters` and `notificationSelection`. Implement these responsibilities without opening an overlay:

  ```js
  async function selectNotification(id) {
    notificationSelection = { id, loading: true, data: null, error: "" };
    updateMainStatusDom();
    try {
      const data = await window.winplate.getNotificationDetail(id);
      notificationSelection = { id, loading: false, data, error: "" };
      if (data?.notification?.unread) await markNotificationRead(id, { feedback: "" });
    } catch (error) {
      notificationSelection = { id, loading: false, data: null, error: error.message || "通知详情加载失败" };
    }
    updateMainStatusDom();
  }
  ```

  Render the heading (smart summary, source/state selects, unread count, clear controls), left filtered list, and right detail/empty/retry pane from `notificationContent`. Route `data-notification-select`, `data-notification-filter`, `data-notification-detail-retry`, and action buttons through the existing delegated click handler. Update external `notificationId` navigation to call `selectNotification` and, without an id, leave the right pane unselected.

- [ ] **Step 5: Add responsive and state styles**

  Add a two-column grid with a compact single-column breakpoint and explicit selected/unread/read states:

  ```css
  .notification-workspace { display: grid; grid-template-columns: minmax(280px, .82fr) minmax(0, 1.45fr); min-height: 560px; border: 1px solid var(--border); border-radius: 18px; overflow: hidden; }
  .notification-master-row.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 13%, var(--surface)); }
  .notification-detail-empty { display: grid; place-content: center; min-height: 320px; text-align: center; }
  @media (max-width: 760px) { .notification-workspace { grid-template-columns: 1fr; } }
  ```

- [ ] **Step 6: Run focused renderer tests and syntax validation**

  Run: `node --test apps/windows-electron/src/renderer/security.test.js; node --check apps/windows-electron/src/renderer/app.js; node --check apps/windows-electron/src/renderer/components/notificationDigest.js`

  Expected: PASS, with no `notificationDrawer` or raw `<details>` dependency remaining in notification-center tests.

- [ ] **Step 7: Commit the master-detail center**

  ```bash
  git add apps/windows-electron/src/renderer/components/notificationDigest.js apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js
  git commit -m "feat: use master detail notification center"
  ```

## Task 3: Add active-red QWeather acknowledgement modal

**Files:**
- Modify: `apps/windows-electron/src/renderer/components/notificationDigest.js`
- Modify: `apps/windows-electron/src/renderer/app.js:3430-3735,4019-4053`
- Modify: `apps/windows-electron/src/renderer/styles.css`
- Modify: `apps/windows-electron/src/renderer/security.test.js`

**Interfaces:**
- Consumes persisted `notification.metadata` from Task 1 and `markNotificationRead(id)` from Task 2.
- Produces `isAcknowledgementRequired(item)` and a modal activated by `notificationAcknowledgement.id`.

- [ ] **Step 1: Add failing modal eligibility and lifecycle tests**

  Add component and harness tests covering all required cases:

  ```js
  assert.equal(isAcknowledgementRequired({ source: "qweather", unread: true, metadata: { severity: "red", lifecycle: "issued" } }), true);
  assert.equal(isAcknowledgementRequired({ source: "qweather", unread: true, metadata: { severity: "red", lifecycle: "resolved" } }), false);
  assert.equal(isAcknowledgementRequired({ source: "github", level: "critical", unread: true, metadata: { severity: "red" } }), false);
  assert.equal(isAcknowledgementRequired({ source: "qweather", level: "critical", unread: true, metadata: { severity: "extreme", lifecycle: "issued" } }), false);
  ```

  Add click tests proving `data-notification-acknowledge` calls `markNotificationRead`, while `Escape`, close, and backdrop leave the mark-read call list unchanged.

- [ ] **Step 2: Run the focused renderer tests and verify they fail**

  Run: `node --test apps/windows-electron/src/renderer/security.test.js --test-name-pattern="acknowledgement|notification modal"`

  Expected: FAIL because `isAcknowledgementRequired` and modal controls do not exist.

- [ ] **Step 3: Implement exact structured-data eligibility and queue selection**

  In `notificationDigest.js`, add the predicate without title/body inspection:

  ```js
  function isAcknowledgementRequired(item = {}) {
    const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
    return item.source === "qweather"
      && item.unread === true
      && metadata.severity === "red"
      && !["resolved", "cancelled", "ended"].includes(metadata.lifecycle);
  }
  ```

  In `app.js`, derive newest-first candidates after each successful notification hydration. Hold one candidate in `notificationAcknowledgement`; maintain a session-local dismissed-id set so dismissing a dialog does not immediately re-open the same alert during the same refresh generation. Do not add a persistence table or change notification unread state during dismissal.

- [ ] **Step 4: Render and operate the focus-safe modal**

  Append this semantic shape to the main shell only when an acknowledgement is selected:

  ```html
  <div class="notification-acknowledgement-backdrop" data-notification-ack-dismiss>
    <section class="notification-acknowledgement-modal" role="dialog" aria-modal="true" aria-labelledby="notification-ack-title" aria-describedby="notification-ack-body">
      <button type="button" data-notification-ack-dismiss aria-label="暂不确认">×</button>
      <p>QWEATHER · 红色预警</p>
      <h2 id="notification-ack-title">${escapeHtml(item.title)}</h2>
      <p id="notification-ack-body">${escapeHtml(item.message || "请关注最新天气预警信息。")}</p>
      <button type="button" data-notification-acknowledge="${escapeHtml(item.id)}">我已知悉</button>
    </section>
  </div>
  ```

  Stop propagation from the dialog, focus its acknowledgement button on open, cycle Tab within its close/action controls, restore the previously focused element after any dismissal, and intercept Escape only while this modal is open. The acknowledge handler must await `markNotificationRead(id)`, close the modal only on success, and then refresh digest/center state.

- [ ] **Step 5: Add modal visual treatment and run focused verification**

  Add a fixed backdrop, red but readable surface, visible keyboard focus ring, and a light-theme counterpart. Then run:

  `node --test apps/windows-electron/src/renderer/security.test.js --test-name-pattern="acknowledgement|notification modal"`

  Expected: PASS for red active only, explicit acknowledgement read marking, and non-destructive dismissals.

- [ ] **Step 6: Commit the acknowledgement flow**

  ```bash
  git add apps/windows-electron/src/renderer/components/notificationDigest.js apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js
  git commit -m "feat: acknowledge active red weather alerts"
  ```

## Task 4: Show source-card quick previews and navigate to the selected notification

**Files:**
- Modify: `apps/windows-electron/src/renderer/app.js:1538-1559,1991-2018,2059-2104,2834-3032,3820-3823`
- Modify: `apps/windows-electron/src/renderer/styles.css`
- Modify: `apps/windows-electron/src/renderer/security.test.js`

**Interfaces:**
- Consumes `findPreviewableNotification(source)` from the renderer and `selectNotification(id)` from Task 2.
- Produces optional `data-notification-preview-id` on Dashboard, QWeather, and GitHub cards.

- [ ] **Step 1: Add failing source-preview and navigation tests**

  Add tests asserting that only unread `warning` or `critical` notifications are previewable, a matching GitHub/QWeather/Dashboard card emits its notification id, and a card click invokes the exact Notifications navigation payload:

  ```js
  assert.equal(findPreviewableNotification("github")?.id, "github:sync-failed");
  assert.equal(findPreviewableNotification("qweather")?.id, "qweather:red-1");
  assert.equal(findPreviewableNotification("github", [{ id: "g1", source: "github", level: "info", unread: true }]), null);
  assert.match(renderer, /section: "Notifications", notificationId: previewId/);
  ```

- [ ] **Step 2: Run the source-preview test slice and verify it fails**

  Run: `node --test apps/windows-electron/src/renderer/security.test.js --test-name-pattern="source preview|source-card navigation"`

  Expected: FAIL because no source-preview resolver or preview-id markup exists.

- [ ] **Step 3: Render hover previews from the normalized notification list**

  Add a renderer-local resolver and attach its result to the three card renderers:

  ```js
  function findPreviewableNotification(source, items = notificationSummary.items) {
    return (Array.isArray(items) ? items : [])
      .filter((item) => item.source === source && item.unread && ["warning", "critical"].includes(item.level))
      .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))[0] || null;
  }

  function notificationPreviewMarkup(source) {
    const item = findPreviewableNotification(source);
    if (!item) return "";
    return `<div class="module-notification-preview" role="tooltip" data-notification-preview-id="${escapeHtml(item.id)}">
      <span>${escapeHtml(notificationSourceLabel(item.source))} · ${escapeHtml(notificationLevelLabel(item.level))}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.message || "暂无详细内容。")}</p>
      <small>${escapeHtml(relativeUpdatedAt(item.createdAt))}</small>
    </div>`;
  }
  ```

  Insert the helper into `dashboardGithubCard`, `weatherDashboardCard`, and `qweatherServiceCard`. The preview shows source, title, short message, level, and relative time. Keep it hidden until its card is hovered or keyboard-focused; do not show stale markup when no matching unread item remains.

- [ ] **Step 4: Bind a preview click to selected Notifications navigation**

  Add one delegated binding for `[data-notification-preview-id]` and its containing card. In the main renderer, set `currentSection = "Notifications"`, call `renderMain()`, then `await selectNotification(previewId)`. For the floating-window source cards, call:

  ```js
  window.winplate.showMainWindow({ section: "Notifications", notificationId: previewId });
  ```

  Preserve normal card behavior when there is no preview id: GitHub opens GitHub and weather opens QWeather.

- [ ] **Step 5: Style previews and verify all renderer coverage**

  Use a positioned, pointer-safe preview with `opacity`/`visibility` transitions and focus-visible support:

  ```css
  .dashboard-card { position: relative; }
  .module-notification-preview { opacity: 0; visibility: hidden; pointer-events: none; }
  .dashboard-card:hover .module-notification-preview,
  .dashboard-card:focus-within .module-notification-preview { opacity: 1; visibility: visible; }
  ```

  Run: `node --test apps/windows-electron/src/renderer/security.test.js; npm --prefix apps/windows-electron run check:syntax`

  Expected: PASS; preview markup remains escaped, source navigation selects the intended item, and legacy safe tooltip behavior still parses.

- [ ] **Step 6: Commit the quick-preview integration**

  ```bash
  git add apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js
  git commit -m "feat: preview source notifications from module cards"
  ```

## Task 5: Run the complete verification matrix

**Files:**
- Modify only if verification exposes a focused defect: files named by the failing check above.

**Interfaces:**
- Consumes all completed slices.
- Produces recorded command output supporting completion.

- [ ] **Step 1: Run backend notification coverage**

  Run: `python -m unittest backend.local-api.tests.test_app`

  Expected: PASS, including QWeather notification persistence and read lifecycle coverage.

- [ ] **Step 2: Run Electron syntax and unit suites**

  Run: `npm --prefix apps/windows-electron run check:syntax; npm --prefix apps/windows-electron run test:unit`

  Expected: both commands exit 0; renderer security tests validate workspace, modal, and card preview contracts.

- [ ] **Step 3: Inspect the final change set and commit any verification-only correction**

  Run: `git diff --check; git status --short`

  Expected: no whitespace errors. If a focused correction was needed, add only the files it changed and commit it with a message describing that correction; otherwise do not create an empty commit.
