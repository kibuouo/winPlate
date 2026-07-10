# Notification Digest Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the notification digest card's redundant inline expansion with a Mail-style right drawer that exposes the represented notifications and their real details/actions.

**Architecture:** Keep selection and markup generation in the existing pure `notificationDigest.js` browser component, while `app.js` owns drawer navigation, asynchronous detail loading, focus restoration, and action refresh. Reuse the current notification-detail IPC/action boundary and consolidate digest-list and single-item views into one notification drawer shell.

**Tech Stack:** Electron 40, browser JavaScript, CommonJS/Node test runner, JSDOM-based renderer harness, CSS.

## Global Constraints

- Do not change digest generation, AI summarization, persistence, or IPC contracts unless a failing test proves source IDs cannot identify represented items.
- The raw notification history remains available.
- Stored notification text is the fallback when source detail is unavailable; never render an empty metadata-only panel.
- All interpolated content remains HTML-escaped and notification actions remain restricted by the current allowlist.
- Preserve the user's unrelated working-tree edits in `apps/windows-electron/src/main/`.

---

### Task 1: Pure digest item selection and drawer list markup

**Files:**
- Modify: `apps/windows-electron/src/renderer/components/notificationDigest.js`
- Test: `apps/windows-electron/src/renderer/security.test.js`

**Interfaces:**
- Consumes: normalized digest `{ sourceIds: string[], unreadCount: number }` and notification items with `{ id, sourceId, level, createdAt, unread }`.
- Produces: `selectDigestItems(digest, items): Notification[]` and `renderDigestDrawerList(digest, items, helpers): string` on `window.WinPlateNotificationDigest`.

- [ ] **Step 1: Write failing component tests**

Add VM-based assertions beside the existing notification digest component tests:

```js
test("digest drawer selects represented notifications by priority then recency", () => {
  const api = loadNotificationDigestComponent();
  const items = [
    { id: "info", sourceId: "info", level: "info", createdAt: 30, unread: true },
    { id: "warn-old", sourceId: "warn-old", level: "warning", createdAt: 10, unread: true },
    { id: "warn-new", sourceId: "warn-new", level: "warning", createdAt: 20, unread: true },
    { id: "excluded", sourceId: "excluded", level: "critical", createdAt: 40, unread: true }
  ];
  assert.deepEqual(
    api.selectDigestItems({ sourceIds: ["info", "warn-old", "warn-new"] }, items).map((item) => item.id),
    ["warn-new", "warn-old", "info"]
  );
});

test("digest drawer list escapes content and renders useful empty state", () => {
  const api = loadNotificationDigestComponent();
  const html = api.renderDigestDrawerList({}, [{
    id: "n1", title: "<script>alert(1)</script>", body: "full body", source: "local", unread: true
  }]);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /data-notification-drawer-item="n1"/);
  assert.match(api.renderDigestDrawerList({}, []), /暂无需要处理的通知/);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test --test-name-pattern="digest drawer" apps/windows-electron/src/renderer/security.test.js`

Expected: FAIL because `selectDigestItems` and `renderDigestDrawerList` are not exported.

- [ ] **Step 3: Implement minimal pure helpers**

Add severity ranking, source-ID matching with unread fallback, deterministic sorting, and escaped button-card markup:

```js
const LEVEL_RANK = { critical: 4, danger: 4, warning: 3, success: 2, info: 1 };

function selectDigestItems(digest = {}, items = []) {
  const value = normalizeDigest(digest);
  const ids = new Set(value.sourceIds.map(String));
  const represented = ids.size
    ? items.filter((item) => ids.has(String(item.sourceId || item.id)))
    : items.filter((item) => item.unread);
  return represented.slice().sort((left, right) =>
    (LEVEL_RANK[right.level] || 0) - (LEVEL_RANK[left.level] || 0)
      || Number(right.createdAt || 0) - Number(left.createdAt || 0)
  );
}

function renderDigestDrawerList(digest, items, { sourceLabel, relativeTime } = {}) {
  const list = selectDigestItems(digest, items);
  if (!list.length) return '<div class="notification-drawer-empty"><strong>暂无需要处理的通知</strong></div>';
  return `<div class="notification-drawer-list">${list.map((item) => `
    <button class="notification-drawer-item level-${escapeHtml(item.level || "info")}" type="button" data-notification-drawer-item="${escapeHtml(item.id)}">
      <span>${escapeHtml(sourceLabel?.(item.source) || item.source || "WinPlate")}</span>
      <strong>${escapeHtml(item.title || "通知")}</strong>
      <p>${escapeHtml(item.body || item.message || "暂无详细内容。")}</p>
      <small>${escapeHtml(relativeTime?.(item.createdAt) || "")}${item.unread ? " · 未读" : " · 已读"}</small>
    </button>`).join("")}</div>`;
}
```

Export both functions from `WinPlateNotificationDigest`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test --test-name-pattern="digest drawer" apps/windows-electron/src/renderer/security.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the pure component change**

```powershell
git add -- apps/windows-electron/src/renderer/components/notificationDigest.js apps/windows-electron/src/renderer/security.test.js
git commit -m "feat: render digest notification drawer list"
```

### Task 2: Replace inline explorer state with drawer navigation

**Files:**
- Modify: `apps/windows-electron/src/renderer/app.js`
- Modify: `apps/windows-electron/src/renderer/components/notificationDigest.js`
- Test: `apps/windows-electron/src/renderer/security.test.js`

**Interfaces:**
- Consumes: Task 1 `renderDigestDrawerList()` and existing `openNotificationDetail(id)`/`handleNotificationAction(id)`.
- Produces: renderer state `notificationDrawer = { open, mode, returnFocus }`, `openNotificationDigestDrawer()`, `showNotificationDrawerList()`, and one `notificationDrawer()` renderer.

- [ ] **Step 1: Write failing structural and interaction tests**

Add assertions that the card is a keyboard button, the inline explorer is absent, and the unified drawer contains list/detail navigation hooks:

```js
test("notification digest opens a unified drawer instead of inline explorer", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const component = fs.readFileSync(path.join(__dirname, "components", "notificationDigest.js"), "utf8");
  assert.match(component, /role="button"/);
  assert.match(component, /aria-controls="notification-digest-drawer"/);
  assert.match(renderer, /function openNotificationDigestDrawer/);
  assert.match(renderer, /function showNotificationDrawerList/);
  assert.match(renderer, /data-notification-drawer-item/);
  assert.doesNotMatch(renderer, /function notificationDigestExplorer/);
  assert.doesNotMatch(renderer, /notificationDigestExpanded/);
  assert.doesNotMatch(renderer, /notificationDigestGroupKey/);
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test --test-name-pattern="unified drawer" apps/windows-electron/src/renderer/security.test.js`

Expected: FAIL because the current renderer still contains the inline explorer state and function.

- [ ] **Step 3: Implement unified state and rendering**

Replace `notificationDigestExpanded`, `notificationDigestGroupKey`, and separate open-state assumptions with:

```js
let notificationDrawerState = { open: false, mode: "list", returnFocus: null };

function openNotificationDigestDrawer(trigger = null) {
  notificationDrawerState = { open: true, mode: "list", returnFocus: trigger };
  notificationDetail = { open: false, loading: false, id: null, data: null, error: "" };
}

function showNotificationDrawerList() {
  notificationDrawerState = { ...notificationDrawerState, open: true, mode: "list" };
}
```

Make `openNotificationDetail()` set `{ open: true, mode: "detail" }`, render list or detail within `<aside id="notification-digest-drawer" class="notification-detail-drawer" role="dialog" aria-modal="true">`, add a back button in detail mode, and remove `notificationDigestExplorer()` from `notificationContent()`.

Update non-compact digest markup to:

```html
<section class="notification-digest-card ..." role="button" tabindex="0"
  aria-expanded="false" aria-controls="notification-digest-drawer"
  data-notification-digest-open="true">
```

- [ ] **Step 4: Wire click navigation and verify GREEN**

In `handleNotificationPageClick`, handle in this order: action/read buttons, close, back, drawer item, raw notification item, digest trigger. Remove digest group and toggle branches.

Run: `node --test --test-name-pattern="notification digest|notification detail" apps/windows-electron/src/renderer/security.test.js`

Expected: PASS.

- [ ] **Step 5: Commit renderer navigation**

```powershell
git add -- apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/components/notificationDigest.js apps/windows-electron/src/renderer/security.test.js
git commit -m "feat: open notification digest in detail drawer"
```

### Task 3: Keyboard, focus, retry, and in-place read refresh

**Files:**
- Modify: `apps/windows-electron/src/renderer/app.js`
- Test: `apps/windows-electron/src/renderer/security.test.js`

**Interfaces:**
- Consumes: Task 2 drawer state/functions and existing `hydrateNotificationDigest()`/notification action bridge.
- Produces: `closeNotificationDrawer({ restoreFocus = true })`, digest Enter/Space activation, Escape close, detail retry, and list-preserving mark-read refresh.

- [ ] **Step 1: Add failing renderer interaction tests**

Extend the renderer harness to assert:

```js
test("notification drawer supports keyboard open, Escape close, focus restore, back and retry", async () => {
  harness.dispatchDigestKey("Enter");
  assert.equal(harness.drawer().getAttribute("role"), "dialog");
  harness.clickDrawerItem("n1");
  harness.click("[data-notification-detail-back]");
  assert.match(harness.drawer().textContent, /通知/);
  harness.dispatchDocument("keydown", { key: "Escape" });
  assert.equal(harness.drawer(), null);
  assert.equal(harness.activeElement(), harness.digestTrigger());
});
```

Add a failed `getNotificationDetail` response and verify `[data-notification-detail-retry]` calls the bridge again for the same ID.

- [ ] **Step 2: Run focused interaction test and verify RED**

Run: `node --test --test-name-pattern="notification drawer supports" apps/windows-electron/src/renderer/security.test.js`

Expected: FAIL because keyboard open, focus restoration, back, and retry are not all implemented.

- [ ] **Step 3: Implement keyboard/focus behavior and retry**

Add a delegated `keydown` handler for Enter/Space on `[data-notification-digest-open]`, extend the existing Escape handler to close the notification drawer, focus the close/back control after rendering, and restore the saved trigger on close using `queueMicrotask`.

Render retry only in error mode:

```html
<button type="button" data-notification-detail-retry="ID">重试</button>
```

After `markRead`, refresh summary/digest, keep list mode open when represented items remain, and show the existing live-region action feedback.

- [ ] **Step 4: Run focused and full renderer tests**

Run: `node --test apps/windows-electron/src/renderer/security.test.js`

Expected: PASS with no warnings or unhandled rejections.

- [ ] **Step 5: Commit accessible interactions**

```powershell
git add -- apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/security.test.js
git commit -m "fix: complete notification drawer interactions"
```

### Task 4: Mail-matched visual treatment and final verification

**Files:**
- Modify: `apps/windows-electron/src/renderer/styles.css`
- Test: `apps/windows-electron/src/renderer/security.test.js`

**Interfaces:**
- Consumes: unified drawer/list classes from Tasks 1-3.
- Produces: responsive Mail-style drawer appearance in light/dark themes and removal of obsolete explorer CSS.

- [ ] **Step 1: Add failing CSS contract assertions**

```js
test("notification digest drawer reuses the Mail drawer layout contract", () => {
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  assert.match(css, /\.mail-detail-drawer,\s*\.notification-detail-drawer\s*\{/);
  assert.match(css, /\.notification-drawer-list/);
  assert.match(css, /\.notification-drawer-item:focus-visible/);
  assert.doesNotMatch(css, /\.notification-digest-explorer/);
  assert.doesNotMatch(css, /\.notification-digest-filters/);
});
```

- [ ] **Step 2: Run CSS contract test and verify RED**

Run: `node --test --test-name-pattern="Mail drawer layout contract" apps/windows-electron/src/renderer/security.test.js`

Expected: FAIL until shared selectors, list styles, and obsolete-rule removal are complete.

- [ ] **Step 3: Implement responsive visual styles**

Share positioning, glass background, shadow, width, maximum height, and responsive offsets between `.mail-detail-drawer` and `.notification-detail-drawer`. Add scrollable `.notification-drawer-list`, full-width card buttons, severity accents, hover/focus-visible states, empty/error panels, and back/retry controls. Remove `.notification-digest-explorer` and `.notification-digest-filters` rules.

- [ ] **Step 4: Run automated verification**

Run:

```powershell
npm run check:syntax --workspace @winplate/windows-electron
node --test apps/windows-electron/src/renderer/security.test.js
npm run test:unit --workspace @winplate/windows-electron
```

Expected: all commands exit 0 with no test failures.

- [ ] **Step 5: Run manual Electron QA**

Run: `npm run dev --workspace @winplate/windows-electron`

Verify in light and dark themes:

1. One click on the smart digest opens the right drawer.
2. No inline "摘要详情" layer appears.
3. The drawer shows the actual represented notifications, ordered by severity and recency.
4. Selecting an item shows real detail/actions in the same drawer; Back returns to the list.
5. Close and Escape restore focus to the digest card.
6. Empty, loading, error/retry, read, and minimum-window-width states remain legible.

- [ ] **Step 6: Commit styling and verification contract**

```powershell
git add -- apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js
git commit -m "style: match notification drawer to mail details"
```
