# Notification Inline Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized selected-notification card with a compact
inline summary and give every timeline row a clear, source-specific icon.

**Architecture:** Keep selection, detail loading, and safe action execution in
`app.js`. Extend the timeline component only with a structural source-icon
container. The application supplies whitelisted icon markup and the compact
summary payload; CSS owns the circular icon treatment and responsive summary
layout.

**Tech Stack:** Vanilla JavaScript, existing whitelisted smart-notification
icons, CSS, Node built-in test runner.

## Global Constraints

- Modify only Notifications timeline rows, selected inline summaries, and
  source icon presentation.
- Preserve existing date grouping, source filters, selection, mark-read,
  navigation, red-weather acknowledgement, and safe action IDs.
- Keep all notification body and action text escaped before HTML rendering.
- Use only existing whitelisted smart-notification icon keys; add no assets,
  handwritten SVGs, or dependencies.
- The compact summary omits title duplication and operational metadata.
- Do not create a branch or worktree; execute directly on `main`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/windows-electron/src/renderer/components/notificationDigest.js` | Adds the decorative source-icon container to safe timeline row markup. |
| `apps/windows-electron/src/renderer/app.js` | Maps sources to icon keys and renders the compact selected-row summary. |
| `apps/windows-electron/src/renderer/styles.css` | Defines circular source icons, concise inline summary, action alignment, and narrow layout. |
| `apps/windows-electron/src/renderer/security.test.js` | Verifies timeline structure, source mappings, compact detail contract, escaped output, and CSS selectors. |

## Task 1: Add structural source-icon containers to timeline rows

**Files:**
- Modify: `apps/windows-electron/src/renderer/components/notificationDigest.js:151-178`
- Modify: `apps/windows-electron/src/renderer/security.test.js:1534-1557`

**Interfaces:**
- Consumes `sourceIcon(source) -> string` supplied by `app.js`.
- Produces `<span class="notification-source-icon source-<source>" aria-hidden="true">` in every timeline row.
- Preserves the adjacent text source label as the accessible source name.

- [ ] **Step 1: Write a failing component contract test**

  Extend the existing timeline test in
  `apps/windows-electron/src/renderer/security.test.js`:

  ```js
  const html = api.renderNotificationTimeline(items, {
    selectedId: "today", now, sourceLabel: (value) => value,
    sourceIcon: (source) => `<i data-icon="${source}"></i>`,
    levelLabel: (value) => value, relativeTime: () => "刚刚"
  });
  assert.match(html, /class="notification-source-icon source-codex" aria-hidden="true"><i data-icon="codex"><\/i><\/span>/);
  assert.match(html, /class="notification-source-icon source-github" aria-hidden="true"><i data-icon="github"><\/i><\/span>/);
  ```

- [ ] **Step 2: Run the focused test and verify it fails**

  Run:

  ```powershell
  node --test --test-name-pattern "notification timeline groups" apps/windows-electron/src/renderer/security.test.js
  ```

  Expected: FAIL because `sourceIcon` is currently injected inside the text
  source label and no `notification-source-icon` container exists.

- [ ] **Step 3: Implement the minimal row structure**

  In `renderNotificationTimeline`, replace the current source-label fragment:

  ```js
  <span class="notification-source">${sourceIcon?.(item.source) || ""}${escapeHtml(sourceLabel?.(item.source) || item.source || "WinPlate")}</span>
  ```

  with:

  ```js
  <span class="notification-source-icon source-${escapeHtml(item.source || "system")}" aria-hidden="true">${sourceIcon?.(item.source) || ""}</span>
  <span class="notification-source">${escapeHtml(sourceLabel?.(item.source) || item.source || "WinPlate")}</span>
  ```

- [ ] **Step 4: Run focused coverage and syntax validation**

  Run:

  ```powershell
  node --test --test-name-pattern "notification timeline groups" apps/windows-electron/src/renderer/security.test.js
  node --check apps/windows-electron/src/renderer/components/notificationDigest.js
  ```

  Expected: PASS, with escaped source names and decorative icon containers.

- [ ] **Step 5: Commit the source-icon structure**

  ```powershell
  git add apps/windows-electron/src/renderer/components/notificationDigest.js apps/windows-electron/src/renderer/security.test.js
  git commit -m "feat: add notification source icon containers"
  ```

## Task 2: Render compact selected summaries and source-specific icon styling

**Files:**
- Modify: `apps/windows-electron/src/renderer/app.js:989-991,2585-2603`
- Modify: `apps/windows-electron/src/renderer/styles.css:1675-1726`
- Modify: `apps/windows-electron/src/renderer/security.test.js:1557-1575,1809-1818`

**Interfaces:**
- Consumes `notificationSelection`, `payload.detail`, `payload.actions`,
  `notificationSourceIconKey(source)`, and existing `notificationActionButton`.
- Produces `notificationInlineDetail() -> string` with only compact body,
  loading/error/retry feedback, and safe `navigate`/`markRead` action buttons.
- Produces source-specific CSS classes for Codex, GitHub, mail, QWeather, and
  fallback icon circles.

- [ ] **Step 1: Write failing renderer and style contracts**

  Add these tests to `apps/windows-electron/src/renderer/security.test.js`:

  ```js
  test("notification inline detail keeps only concise content and safe row actions", () => {
    const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
    const inline = renderer.slice(renderer.indexOf("function notificationInlineDetail"), renderer.indexOf("function updateNotificationAcknowledgement"));
    assert.match(inline, /class="notification-inline-summary"/);
    assert.match(inline, /action\.type === "navigate" \|\| action\.type === "markRead"/);
    assert.match(inline, /action\.type === "navigate" \? "打开来源"/);
    assert.doesNotMatch(inline, /notification-detail-meta/);
    assert.doesNotMatch(inline, /<h2>/);
  });

  test("notification timeline styles identify each source with a circular icon", () => {
    const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
    for (const source of ["codex", "github", "mail", "qweather", "system"]) {
      assert.match(css, new RegExp(`\\.notification-source-icon\\.source-${source}`));
    }
    assert.match(css, /\.notification-inline-summary \{[^}]*max-width:/);
    assert.match(css, /\.notification-inline-summary-actions \{[^}]*justify-content: flex-end;/);
  });
  ```

- [ ] **Step 2: Run focused tests and verify they fail**

  Run:

  ```powershell
  node --test --test-name-pattern "notification inline detail keeps|notification timeline styles identify" apps/windows-electron/src/renderer/security.test.js
  ```

  Expected: FAIL because the existing inline section renders a heading,
  metadata definition list, unrestricted non-view actions, and no source-icon
  variants.

- [ ] **Step 3: Implement the compact summary in `app.js`**

  Replace the body of `notificationInlineDetail()` with this rendering shape;
  retain the current body and retry value expressions:

  ```js
  const actions = Array.isArray(payload.actions)
    ? payload.actions
      .filter((action) => action.type === "navigate" || action.type === "markRead")
      .map((action) => ({
        ...action,
        label: action.type === "navigate"
          ? "打开来源"
          : notification.unread ? "标记已读" : "已读"
      }))
    : [];
  return `<section class="notification-inline-summary" aria-label="通知摘要">
    <div class="notification-inline-summary-body">${body}</div>
    ${notificationActionFeedback ? `<p class="notification-detail-feedback" role="status">${escapeHtml(notificationActionFeedback)}</p>` : ""}
    ${actions.length ? `<footer class="notification-inline-summary-actions">${actions.map(notificationActionButton).join("")}</footer>` : ""}
  </section>`;
  ```

  Continue using `notificationSourceIconKey` with the existing `code`,
  `github`, `mail`, `cloud-rain-alert`, and `bell` keys. Do not move icon-key
  authority out of `app.js`.

- [ ] **Step 4: Implement source circles and compact responsive styles**

  Replace timeline source-label icon rules with:

  ```css
  .notification-timeline-row { grid-template-columns: 22px 44px minmax(0, 1fr) auto; }
  .notification-source-icon { width: 40px; height: 40px; display: grid; place-items: center; align-self: center; color: #2563eb; border-radius: 999px; background: rgba(37, 99, 235, .10); }
  .notification-source-icon .smart-notification-icon { width: 21px; height: 21px; }
  .notification-source-icon.source-codex { color: #2563eb; background: rgba(37, 99, 235, .10); }
  .notification-source-icon.source-github { color: var(--text); background: color-mix(in srgb, var(--text) 9%, transparent); }
  .notification-source-icon.source-mail { color: #64748b; background: rgba(100, 116, 139, .12); }
  .notification-source-icon.source-qweather { color: #059669; background: rgba(16, 185, 129, .12); }
  .notification-source-icon.source-system { color: var(--text-soft); background: var(--surface-muted); }
  .notification-inline-summary { max-width: min(100%, 760px); margin: 0 0 14px 66px; padding: 14px 16px; display: grid; gap: 12px; border: 1px solid rgba(59, 130, 246, .32); border-radius: 10px; background: color-mix(in srgb, #2563eb 5%, var(--surface)); }
  .notification-inline-summary-body { color: var(--text-muted); font-size: 13px; line-height: 1.65; }
  .notification-inline-summary-body p { margin: 0; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .notification-inline-summary-actions { display: flex; justify-content: flex-end; gap: 10px; }
  @media (max-width: 760px) { .notification-timeline-row { grid-template-columns: 18px 40px minmax(0, 1fr); } .notification-source-icon { width: 36px; height: 36px; } .notification-inline-summary { margin-left: 0; } .notification-inline-summary-actions { justify-content: start; flex-wrap: wrap; } }
  ```

  Keep existing `.notification-detail-state` and
  `[data-notification-detail-retry]` rules so loading/error/retry stays
  keyboard-operable within the compact container.

- [ ] **Step 5: Run focused tests, renderer syntax, and commit**

  Run:

  ```powershell
  node --test --test-name-pattern "notification inline detail keeps|notification timeline styles identify|notification timeline groups" apps/windows-electron/src/renderer/security.test.js
  node --check apps/windows-electron/src/renderer/app.js
  node --check apps/windows-electron/src/renderer/components/notificationDigest.js
  ```

  Expected: PASS.

  Then commit:

  ```powershell
  git add apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js
  git commit -m "style: compact notification timeline summaries"
  ```

## Task 3: Verify the complete redesigned notification surface

**Files:**
- Modify: `design-qa.md` with the refreshed visual evidence and final result.

**Interfaces:**
- Verifies all renderer and existing notification action boundaries remain
  functional after the compact presentation change.

- [ ] **Step 1: Run full automated validation**

  Run:

  ```powershell
  npm run check --workspace @winplate/windows-electron
  npm run backend:test
  ```

  Expected: PASS.

- [ ] **Step 2: Perform desktop visual QA**

  Reload the local Electron renderer and inspect Notifications at desktop width:

  1. Codex, GitHub, Mail, and QWeather rows show distinct round icons;
  2. selecting a row renders only a compact summary beneath it;
  3. no duplicated title, metadata card, or oversized body area appears;
  4. source-navigation and mark-read buttons stay aligned to the right when
     available;
  5. source filtering, keyboard focus, and narrow wrapping remain readable.

- [ ] **Step 3: Update QA record and commit verification artifacts**

  Set `design-qa.md` to `**Final result:** passed` only after the visual check
  and automated commands pass, then run:

  ```powershell
  git diff --check
  git add design-qa.md docs/superpowers/plans/2026-07-12-notification-inline-summary.md
  git commit -m "docs: verify compact notification summary"
  ```
