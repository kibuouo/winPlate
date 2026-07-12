# Notification Timeline Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Notifications content area with a source-filtered,
date-grouped timeline whose selected notification expands inline, matching the
approved reference without changing the global navigation or title bar.

**Architecture:** Keep notification data and read-state actions in the existing
local API and Electron IPC boundary. Add a narrow `clear-read` operation so the
reference's “清空已读” control cannot remove unread work. The renderer component
will own pure source-count, date-grouping, and safe timeline-row markup; the
application shell will own selection, detail loading, delegated controls, and
inline detail rendering.

**Tech Stack:** FastAPI and SQLite, Electron IPC/preload bridge, vanilla
JavaScript, Node built-in test runner, CSS.

## Global Constraints

- Change only the Notifications content area; leave the sidebar and custom
  title bar unchanged.
- Preserve existing notification sources, persistence, severity semantics,
  source-card navigation, and the active-red QWeather acknowledgement modal.
- “清空已读” must delete only notifications where `unread` is false; existing
  all-item clear behavior must not be reused by the new control.
- Untrusted notification values must continue through `escapeHtml` before they
  are placed in HTML.
- Rows and filters must remain keyboard-operable and expose their selected or
  expanded state to assistive technology.
- Keep light and dark theme contrast; do not add image assets or dependencies.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/local-api/winplate_local_api/main.py` | Delete read notifications without changing the existing all-notifications endpoint. |
| `backend/local-api/tests/test_app.py` | Prove only read rows are cleared through the local API helper and route. |
| `apps/windows-electron/src/main/main.js` | Expose the guarded `notifications:clear-read` IPC handler. |
| `apps/windows-electron/src/preload/preload.js` | Expose the narrow clear-read method to the renderer. |
| `apps/windows-electron/src/main/integrationSecurity.test.js` | Keep the new IPC channel behind the main-window sender check. |
| `apps/windows-electron/src/renderer/components/notificationDigest.js` | Provide pure source counts, local date groups, and safe timeline-row markup. |
| `apps/windows-electron/src/renderer/app.js` | Render the reference-aligned header, filters, timeline, and inline selected detail; bind the new controls. |
| `apps/windows-electron/src/renderer/styles.css` | Style the responsive source-chip and timeline presentation. |
| `apps/windows-electron/src/renderer/security.test.js` | Verify markup safety, interactions, and the renderer/preload contract. |

## Task 1: Add a guarded clear-read notification operation

**Files:**
- Modify: `backend/local-api/winplate_local_api/main.py:882-886,2589-2591`
- Modify: `backend/local-api/tests/test_app.py:1012-1028`
- Modify: `apps/windows-electron/src/main/main.js:923-944`
- Modify: `apps/windows-electron/src/preload/preload.js:45-48`
- Modify: `apps/windows-electron/src/main/integrationSecurity.test.js:110-118`

**Interfaces:**
- Produces `clear_read_notifications() -> dict` and `DELETE /api/notifications/read`.
- Produces `window.winplate.clearReadNotifications() -> Promise<NotificationSummary>`.
- Consumed by the timeline header in Task 3.

- [ ] **Step 1: Add failing backend tests for preserving unread rows**

  In `backend/local-api/tests/test_app.py`, immediately after
  `test_clear_notifications_removes_all_items`, add:

  ```python
  def test_clear_read_notifications_preserves_unread_items(self):
      original_path = main.DATABASE_PATH
      with tempfile.TemporaryDirectory() as directory:
          main.DATABASE_PATH = Path(directory) / "test.db"
          main.initialize_database()
          main.upsert_notification(
              notification_id="read", source="codex", title="Read",
              unread=False, created_at=1,
          )
          main.upsert_notification(
              notification_id="unread", source="github", title="Unread",
              unread=True, created_at=2,
          )
          summary = main.clear_read_notifications()
          self.assertEqual([item["id"] for item in summary["items"]], ["unread"])
          self.assertEqual(summary["unreadCount"], 1)
      main.DATABASE_PATH = original_path

  def test_delete_read_notifications_route_uses_clear_read_helper(self):
      with patch.object(main, "clear_read_notifications", return_value={"items": []}) as clear:
          response = main.delete_read_notifications()
      self.assertEqual(response, {"items": []})
      clear.assert_called_once_with()
  ```

- [ ] **Step 2: Run the focused backend test and verify it fails for the missing helper**

  Run:

  ```powershell
  npm run backend:test
  ```

  Expected: FAIL because `clear_read_notifications` and its route do not exist.

- [ ] **Step 3: Implement the minimal local API helper and route**

  In `backend/local-api/winplate_local_api/main.py`, retain
  `clear_notifications` unchanged and add directly below it:

  ```python
  def clear_read_notifications() -> dict:
      with closing(connect()) as connection:
          connection.execute("DELETE FROM notifications WHERE unread = 0")
          connection.commit()
      return notification_summary()
  ```

  Add the route immediately before the existing `DELETE /api/notifications`:

  ```python
  @api.delete("/api/notifications/read")
  def delete_read_notifications() -> dict:
      return clear_read_notifications()
  ```

- [ ] **Step 4: Run the focused backend test and verify it passes**

  Run:

  ```powershell
  npm run backend:test
  ```

  Expected: PASS, including both the all-item clear regression test and the
  new read-only clear test.

- [ ] **Step 5: Add the guarded Electron bridge, then test it**

  Add `"notifications:clear-read"` to the guarded channel list in
  `apps/windows-electron/src/main/integrationSecurity.test.js`, then run:

  ```powershell
  node --test apps/windows-electron/src/main/integrationSecurity.test.js
  ```

  Expected: FAIL because the new channel is not yet registered and guarded.

  In `apps/windows-electron/src/main/main.js`, immediately after the
  `notifications:clear` handler, add:

  ```js
  ipcMain.handle("notifications:clear-read", async (event) => {
    requireMainWindowSender(event);
    const response = await fetch("http://127.0.0.1:8765/api/notifications/read", { method: "DELETE" });
    if (!response.ok) {
      throw new Error(`Notification clear-read failed: HTTP ${response.status}`);
    }
    const summary = await response.json();
    clearNotificationCaches();
    scheduleNotificationDigestRefresh();
    return summary;
  });
  ```

  In `apps/windows-electron/src/preload/preload.js`, place the new bridge next
  to `clearNotifications`:

  ```js
  clearReadNotifications: () => ipcRenderer.invoke("notifications:clear-read"),
  ```

  Re-run the same test. Expected: PASS.

- [ ] **Step 6: Commit the safe operation boundary**

  ```powershell
  git add backend/local-api/winplate_local_api/main.py backend/local-api/tests/test_app.py apps/windows-electron/src/main/main.js apps/windows-electron/src/preload/preload.js apps/windows-electron/src/main/integrationSecurity.test.js
  git commit -m "feat: clear read notifications safely"
  ```

## Task 2: Render safe source-chip counts and date-grouped timeline rows

**Files:**
- Modify: `apps/windows-electron/src/renderer/components/notificationDigest.js:92-141`
- Modify: `apps/windows-electron/src/renderer/security.test.js:1513-1587`

**Interfaces:**
- Produces `notificationSourceCounts(items) -> Array<{source: string, count: number}>`.
- Produces `groupNotificationItemsByDate(items, now) -> Array<{key: string, label: string, items: object[]}>`.
- Produces `renderNotificationTimeline(items, options) -> string` with
  `data-notification-select`, `aria-expanded`, escaped content, relative time,
  source, and text level label.
- Consumed by `notificationContent()` in Task 3.

- [ ] **Step 1: Replace the master-detail contract test with failing timeline assertions**

  Replace the existing “filterable master-detail workspace” test in
  `apps/windows-electron/src/renderer/security.test.js` with:

  ```js
  test("notification timeline groups source-filtered rows by date and escapes content", () => {
    const api = loadNotificationDigestComponent();
    const now = new Date("2026-07-12T12:00:00");
    const items = [
      { id: "today", source: "codex", title: "<script>", message: "safe", level: "info", unread: true, createdAt: Date.parse("2026-07-12T08:00:00") },
      { id: "yesterday", source: "github", title: "Review", message: "ready", level: "warning", unread: false, createdAt: Date.parse("2026-07-11T08:00:00") }
    ];
    assert.deepEqual(api.notificationSourceCounts(items), [
      { source: "codex", count: 1 }, { source: "github", count: 1 }
    ]);
    assert.deepEqual(api.groupNotificationItemsByDate(items, now).map((group) => group.label), ["今天 7月12日", "昨天 7月11日"]);
    const html = api.renderNotificationTimeline(items, {
      selectedId: "today", now, sourceLabel: (value) => value,
      levelLabel: (value) => value, relativeTime: () => "刚刚"
    });
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /class="notification-timeline"/);
    assert.match(html, /data-notification-select="today"/);
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /今天 7月12日/);
  });
  ```

- [ ] **Step 2: Run the focused renderer test and verify it fails**

  Run:

  ```powershell
  node --test --test-name-pattern "notification timeline groups" apps/windows-electron/src/renderer/security.test.js
  ```

  Expected: FAIL because the helper methods and timeline markup do not exist.

- [ ] **Step 3: Implement deterministic grouping and timeline markup**

  In `apps/windows-electron/src/renderer/components/notificationDigest.js`, add
  the following helpers before the exported object. Do not mutate `items`:

  ```js
  function notificationSourceCounts(items = []) {
    const sourceOrder = ["codex", "github", "mail", "qweather"];
    return [...(Array.isArray(items) ? items : []).reduce((counts, item) => {
      const source = String(item?.source || "system");
      counts.set(source, (counts.get(source) || 0) + 1);
      return counts;
    }, new Map()).entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((left, right) => {
        const leftIndex = sourceOrder.indexOf(left.source);
        const rightIndex = sourceOrder.indexOf(right.source);
        return (leftIndex < 0 ? sourceOrder.length : leftIndex) - (rightIndex < 0 ? sourceOrder.length : rightIndex)
          || left.source.localeCompare(right.source);
      });
  }

  function dateGroupLabel(date, now) {
    const local = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const days = Math.round((today - local) / 86_400_000);
    const suffix = `${date.getMonth() + 1}月${date.getDate()}日`;
    return days === 0 ? `今天 ${suffix}` : days === 1 ? `昨天 ${suffix}` : suffix;
  }

  function groupNotificationItemsByDate(items = [], now = new Date()) {
    const groups = new Map();
    for (const item of [...(Array.isArray(items) ? items : [])].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))) {
      const date = new Date(Number(item.createdAt || 0));
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      if (!groups.has(key)) groups.set(key, { key, label: dateGroupLabel(date, now), items: [] });
      groups.get(key).items.push(item);
    }
    return [...groups.values()];
  }

  function renderNotificationTimeline(items, {
    selectedId = null, sourceLabel, sourceIcon, levelLabel, relativeTime,
    inlineDetail = () => "", now = new Date()
  } = {}) {
    const groups = groupNotificationItemsByDate(items, now);
    if (!groups.length) {
      return '<div class="notification-timeline-empty"><strong>没有匹配的通知</strong><span>尝试调整筛选条件。</span></div>';
    }
    return `<div class="notification-timeline">${groups.map((group) => `
      <section class="notification-date-group" aria-label="${escapeHtml(group.label)}">
        <h2 class="notification-date-label">${escapeHtml(group.label)}</h2>
        ${group.items.map((item) => {
          const selected = String(item.id) === String(selectedId);
          return `<article class="notification-timeline-entry level-${escapeHtml(item.level || "info")} ${item.unread ? "unread" : ""} ${selected ? "selected" : ""}">
            <button class="notification-timeline-row" type="button" data-notification-select="${escapeHtml(item.id)}" aria-expanded="${selected}">
              <i class="notification-timeline-dot" aria-hidden="true"></i>
              <span class="notification-timeline-main">
                <span class="notification-source">${sourceIcon?.(item.source) || ""}${escapeHtml(sourceLabel?.(item.source) || item.source || "WinPlate")}</span>
                <span class="notification-timeline-title"><strong>${escapeHtml(item.title || "通知")}</strong>${item.unread ? '<em class="unread-badge">未读</em>' : ""}</span>
                <p>${escapeHtml(item.body || item.message || "暂无详细内容。")}</p>
              </span>
              <span class="notification-timeline-meta"><time>${escapeHtml(relativeTime?.(item.createdAt) || "")}</time><span>${escapeHtml(levelLabel?.(item.level) || item.level || "信息")}</span></span>
            </button>
            ${selected ? inlineDetail(item) : ""}
          </article>`;
        }).join("")}
      </section>`).join("")}</div>`;
  }
  ```

  Export the three helpers and `renderNotificationTimeline` via
  `WinPlateNotificationDigest` and retain the
  old digest helper exports for unrelated surfaces.

- [ ] **Step 4: Run focused component tests and syntax validation**

  Run:

  ```powershell
  node --test --test-name-pattern "notification timeline groups" apps/windows-electron/src/renderer/security.test.js
  node --check apps/windows-electron/src/renderer/components/notificationDigest.js
  ```

  Expected: PASS with no unescaped title or message content in the timeline.

- [ ] **Step 5: Commit the pure timeline component**

  ```powershell
  git add apps/windows-electron/src/renderer/components/notificationDigest.js apps/windows-electron/src/renderer/security.test.js
  git commit -m "feat: add notification timeline renderer"
  ```

## Task 3: Replace the notification workspace with the inline timeline flow

**Files:**
- Modify: `apps/windows-electron/src/renderer/app.js:2543-2602,3683-3754,3767-3845`
- Modify: `apps/windows-electron/src/renderer/security.test.js:1534-1704,1744-1760`

**Interfaces:**
- Consumes `notificationSourceCounts`, `renderNotificationTimeline`,
  `clearReadNotifications`, `notificationSelection`, and the existing
  `selectNotification(id)`.
- Produces source-chip controls (`data-notification-source`), an inline detail
  region for only the selected row, and a `#clear-read-notifications` control.

- [ ] **Step 1: Write failing renderer contracts for timeline controls and inline selection**

  In `apps/windows-electron/src/renderer/security.test.js`, add:

  ```js
  test("notification page uses source chips and an inline selected detail instead of a workspace", () => {
    const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
    const page = renderer.slice(renderer.indexOf("function notificationContent"), renderer.indexOf("function updateNotificationAcknowledgement"));
    assert.match(page, /data-notification-source=/);
    assert.match(page, /renderNotificationTimeline/);
    assert.match(page, /notification-inline-detail/);
    assert.match(page, /id="clear-read-notifications"/);
    assert.doesNotMatch(page, /class="notification-workspace"/);
  });

  test("notification page keeps external navigation and selected-row detail loading", () => {
    const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
    assert.match(renderer, /await selectNotification\(selectedNotification\.dataset\.notificationSelect\)/);
    assert.match(renderer, /await selectNotification\(navigation\.notificationId\)/);
    assert.match(renderer, /window\.winplate\.clearReadNotifications\(\)/);
  });
  ```

- [ ] **Step 2: Run the focused renderer tests and verify they fail**

  Run:

  ```powershell
  node --test --test-name-pattern "notification page uses source chips|notification page keeps external" apps/windows-electron/src/renderer/security.test.js
  ```

  Expected: FAIL because the current page still uses `notification-workspace`
  and `clearNotifications()`.

- [ ] **Step 3: Implement the new page markup and inline detail**

  In `notificationContent()` in `apps/windows-electron/src/renderer/app.js`:

  1. Remove `digestCard`, the source `<select>`, the master/detail workspace,
     and the `#clear-notifications` control from this page only.
  2. Build chips from `notificationSourceCounts(items)` plus the “全部” chip:

     ```js
     const sourceCounts = window.WinPlateNotificationDigest.notificationSourceCounts(items);
  const sourceChips = [{ source: "all", count: items.length }, ...sourceCounts].map(({ source, count }) => `
       <button class="notification-source-chip ${notificationFilters.source === source ? "active" : ""}"
         type="button" data-notification-source="${escapeHtml(source)}"
         aria-pressed="${notificationFilters.source === source}">
         <span>${source === "all" ? "" : window.WinPlateSmartNotificationIcons.renderSmartNotificationIcon(notificationSourceIconKey(source))}${escapeHtml(source === "all" ? "全部" : notificationSourceLabel(source))}</span><small>${count}</small>
       </button>`).join("");
     ```

  3. Retain the state `<select data-notification-filter="state">`, but render
     it as the compact secondary filter beside the chips.
  4. Add `notificationSourceIconKey(source)` beside `notificationSourceLabel`:

     ```js
     function notificationSourceIconKey(source) {
       return { codex: "code", github: "github", mail: "mail", qweather: "cloud-rain-alert" }[source] || "bell";
     }
     ```

     Render the selected content inline by passing `sourceIcon` and an
     `inlineDetail` callback to `renderNotificationTimeline`; the callback
     returns an empty string for unselected rows and otherwise calls a renamed
     `notificationInlineDetail()`.
  5. Rename `notificationCenterDetail()` to `notificationInlineDetail()` and
     keep its current safe loading/error/body/metadata/action markup, wrapped
     in `<section class="notification-inline-detail" aria-label="通知详情">`.
     Its retry button must retain `data-notification-detail-retry`.
  6. Use the new header IDs and labels: `#mark-all-notifications-read` with
     “全部标记已读”, `#clear-read-notifications` with “清空已读”, and preserve the
     unread-count pill. Keep `#push-test-notification` reachable but visually
     secondary.

  In `handleNotificationPageClick()`, add delegated source-chip behavior:

  ```js
  const sourceChip = target.closest("[data-notification-source]");
  if (sourceChip) {
    notificationFilters = { ...notificationFilters, source: sourceChip.dataset.notificationSource || "all" };
    updateMainStatusDom();
    return;
  }
  ```

  Place it in `handleNotificationPageClick()` before the selected-row branch.
  Replace the old clear-button binding with `#clear-read-notifications` and
  call `window.winplate.clearReadNotifications()`. If its result no longer
  contains `notificationSelection.id`, reset the selection to the established
  empty `{ id: null, loading: false, data: null, error: "" }` state before
  refreshing the digest.

- [ ] **Step 4: Run focused renderer tests and syntax checks**

  Run:

  ```powershell
  node --test --test-name-pattern "notification page uses source chips|notification page keeps external|external notification navigation" apps/windows-electron/src/renderer/security.test.js
  node --check apps/windows-electron/src/renderer/app.js
  ```

  Expected: PASS. The external navigation test must still prove that a
  `notificationId` calls `selectNotification`.

- [ ] **Step 5: Commit the inline timeline interaction**

  ```powershell
  git add apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/security.test.js
  git commit -m "feat: use inline notification timeline details"
  ```

## Task 4: Apply the reference-aligned responsive visual system

**Files:**
- Modify: `apps/windows-electron/src/renderer/styles.css:1657-1710`
- Modify: `apps/windows-electron/src/renderer/security.test.js:1769-1787`

**Interfaces:**
- Consumes the classes from Tasks 2–3: `notification-source-chip`,
  `notification-timeline`, `notification-date-group`, `notification-timeline-row`,
  `notification-timeline-dot`, and `notification-inline-detail`.
- Produces a keyboard-visible, light/dark compatible timeline at desktop and
  narrow widths.

- [ ] **Step 1: Write failing style-contract tests**

  Replace the obsolete drawer-layout assertions with:

  ```js
  test("notification timeline styles provide source chips, date rules, inline detail, and narrow layout", () => {
    const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
    assert.match(css, /\.notification-source-chip\.active \{[^}]*background: var\(--accent\);/);
    assert.match(css, /\.notification-date-group \{[^}]*border-top:/);
    assert.match(css, /\.notification-timeline::before \{[^}]*background: var\(--border\);/);
    assert.match(css, /\.notification-timeline-row:focus-visible \{[^}]*outline:/);
    assert.match(css, /\.notification-inline-detail \{[^}]*border:/);
    assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*\.notification-timeline-meta/);
  });
  ```

- [ ] **Step 2: Run the focused style test and verify it fails**

  Run:

  ```powershell
  node --test --test-name-pattern "notification timeline styles" apps/windows-electron/src/renderer/security.test.js
  ```

  Expected: FAIL because the stylesheet defines the old master-detail workspace
  rather than the timeline classes.

- [ ] **Step 3: Replace only the Notifications-page layout rules**

  In `apps/windows-electron/src/renderer/styles.css`, replace the rules from
  `.notifications-page` through the existing narrow workspace media rule with:

  ```css
  .notifications-page { display: grid; gap: 0; min-width: 0; }
  .notifications-page-heading { display: flex; align-items: start; justify-content: space-between; gap: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--border); }
  .notifications-page-heading p { margin: 0 0 9px; color: var(--accent); font-size: 10px; font-weight: 800; letter-spacing: .18em; }
  .notifications-page-heading h1 { margin: 0 0 8px; font-size: clamp(30px, 3.2vw, 46px); }
  .notifications-page-heading span { color: var(--text-muted); font-size: 14px; }
  .notification-actions, .notification-source-filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .notification-source-filters { min-height: 68px; justify-content: space-between; border-bottom: 1px solid var(--border); }
  .notification-source-chip { display: inline-flex; align-items: center; gap: 8px; min-height: 38px; padding: 0 13px; color: var(--text-muted); border: 1px solid transparent; border-radius: 12px; background: var(--surface-muted); font: inherit; font-weight: 750; cursor: pointer; }
  .notification-source-chip small { min-width: 20px; padding: 2px 6px; color: inherit; border-radius: 999px; background: color-mix(in srgb, currentColor 12%, transparent); font-size: 11px; text-align: center; }
  .notification-source-chip.active { color: #fff; border-color: var(--accent); background: var(--accent); box-shadow: 0 8px 18px color-mix(in srgb, var(--accent) 24%, transparent); }
  .notification-source-chip:focus-visible, .notification-timeline-row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .notification-timeline { position: relative; display: grid; gap: 0; padding: 10px 0 28px; }
  .notification-timeline::before { position: absolute; top: 66px; bottom: 28px; left: 8px; width: 1px; background: var(--border); content: ""; }
  .notification-date-group { display: grid; gap: 0; border-top: 1px solid var(--border); }
  .notification-date-group:first-child { border-top: 0; }
  .notification-date-label { padding: 18px 0 10px; color: var(--text-soft); font-size: 13px; font-weight: 800; }
  .notification-timeline-entry { display: grid; gap: 0; }
  .notification-timeline-row { position: relative; display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 12px; width: 100%; padding: 14px 0; color: var(--text); text-align: left; border: 0; border-bottom: 1px solid var(--border); background: transparent; font: inherit; cursor: pointer; }
  .notification-timeline-dot { width: 12px; height: 12px; margin-top: 5px; border: 2px solid var(--surface); border-radius: 999px; background: #3b82f6; box-shadow: 0 0 0 1px color-mix(in srgb, #3b82f6 40%, transparent); }
  .notification-timeline-row.level-success .notification-timeline-dot { background: #10b981; }
  .notification-timeline-row.level-warning .notification-timeline-dot { background: #f59e0b; }
  .notification-timeline-row.level-danger .notification-timeline-dot, .notification-timeline-row.level-critical .notification-timeline-dot { background: #ef4444; }
  .notification-timeline-main { display: grid; min-width: 0; gap: 5px; }
  .notification-timeline-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .notification-timeline-title strong { overflow-wrap: anywhere; font-size: 16px; }
  .notification-timeline-title .unread-badge { color: var(--accent); font-size: 11px; font-weight: 800; }
  .notification-timeline-main p { margin: 0; overflow: hidden; color: var(--text-muted); font-size: 13px; line-height: 1.5; text-overflow: ellipsis; white-space: nowrap; }
  .notification-timeline-meta { display: flex; align-items: center; justify-content: end; gap: 12px; color: var(--text-soft); font-size: 12px; white-space: nowrap; }
  .notification-inline-detail { display: grid; gap: 14px; margin: 0 0 14px 34px; padding: 18px 20px; border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--border)); border-radius: 12px; background: color-mix(in srgb, var(--accent) 5%, var(--surface)); }
  .notification-timeline-empty { min-height: 240px; display: grid; place-content: center; gap: 8px; color: var(--text-muted); text-align: center; }
  @media (max-width: 760px) { .notifications-page-heading { display: grid; } .notification-source-filters { align-items: start; padding: 12px 0; } .notification-timeline-row { grid-template-columns: 18px minmax(0, 1fr); } .notification-timeline-meta { justify-content: start; flex-wrap: wrap; white-space: normal; } .notification-inline-detail { margin-left: 0; } }
  ```

  Retain the shared `.notification-detail-state`, `.notification-detail-meta`,
  action, acknowledgement-modal, and source-preview rules used outside this
  page. Remove only master-detail rules that are no longer referenced.

- [ ] **Step 4: Run focused visual contracts and renderer syntax checks**

  Run:

  ```powershell
  node --test --test-name-pattern "notification timeline styles|notification timeline groups|notification page uses source chips" apps/windows-electron/src/renderer/security.test.js
  node --check apps/windows-electron/src/renderer/app.js
  node --check apps/windows-electron/src/renderer/components/notificationDigest.js
  ```

  Expected: PASS.

- [ ] **Step 5: Commit the timeline styling**

  ```powershell
  git add apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js
  git commit -m "style: align notification center with timeline design"
  ```

## Task 5: Verify the complete Electron notification flow

**Files:**
- Modify: `apps/windows-electron/src/renderer/security.test.js` only if a
  verification failure exposes a missing required contract.

**Interfaces:**
- Verifies the public renderer, preload, IPC, and local API boundaries created
  in Tasks 1–4.

- [ ] **Step 1: Run all focused notification and IPC coverage**

  Run:

  ```powershell
  node --test apps/windows-electron/src/renderer/security.test.js
  node --test apps/windows-electron/src/main/integrationSecurity.test.js
  npm run backend:test
  ```

  Expected: PASS with no test failures.

- [ ] **Step 2: Run package-level validation**

  Run:

  ```powershell
  npm run check --workspace @winplate/windows-electron
  ```

  Expected: PASS, including syntax, Electron unit tests, and Python service
  coverage.

- [ ] **Step 3: Perform visual verification in the Electron app**

  Start the application with:

  ```powershell
  npm run dev --workspace @winplate/windows-electron
  ```

  Verify the Notifications section at desktop and a narrow window width:

  1. sidebar and title bar are unchanged;
  2. source chips and unread count match the current data;
  3. dates group newest-first rows and the active source chip filters rows;
  4. clicking a row expands its safe detail in place and marks an unread row
     read;
  5. “清空已读” leaves unread rows intact;
  6. an external `notificationId` navigation expands the matching row;
  7. keyboard focus is visible on chips and rows; and
  8. dark and light themes retain readable metadata, dots, and selected detail.

- [ ] **Step 4: Inspect the final diff and commit any verification correction**

  Run:

  ```powershell
  git diff --check
  git status --short
  ```

  If a verification-only correction is required, add its failing test first,
  re-run the affected command, then commit it with:

  ```powershell
  git add apps/windows-electron/src/renderer/security.test.js apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/styles.css
  git commit -m "fix: polish notification timeline verification"
  ```
