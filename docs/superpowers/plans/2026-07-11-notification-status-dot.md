# Notification Status Dot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace notification drawer severity stripes with compact severity-colored status dots before each source label.

**Architecture:** Keep the existing notification level class on each drawer item as the semantic input. Add a decorative dot to the component markup and map the existing `level-*` classes to dot colors in CSS, while returning the card itself to one uniform border.

**Tech Stack:** Electron renderer, vanilla JavaScript templates, CSS, Node.js test runner.

## Global Constraints

- Change only notification drawer list-item markup, styles, and their renderer regression tests.
- Keep notification data, severity calculation, detail view, text, spacing, and interactions unchanged.
- The decorative status dot must be hidden from assistive technology.

---

### Task 1: Replace severity stripes with status dots

**Files:**
- Modify: `apps/windows-electron/src/renderer/components/notificationDigest.js:47-54`
- Modify: `apps/windows-electron/src/renderer/styles.css:1549-1580`
- Test: `apps/windows-electron/src/renderer/security.test.js:1447-1458,1647-1652`

**Interfaces:**
- Consumes: each notification item's existing `level` value and resulting `level-info`, `level-success`, `level-warning`, `level-critical`, or `level-danger` class.
- Produces: `<i class="notification-status-dot" aria-hidden="true"></i>` immediately before the escaped source label.

- [ ] **Step 1: Write the failing renderer and CSS regression assertions**

Extend the drawer rendering test with:

```js
assert.match(html, /<span><i class="notification-status-dot" aria-hidden="true"><\/i>WinPlate<\/span>/);
```

Replace the severity-stripe assertion with checks that require a uniform card border, dot geometry, and semantic colors:

```js
assert.doesNotMatch(css, /\.notification-drawer-item[^}]*border-left:\s*3px/);
assert.match(css, /\.notification-status-dot \{[^}]*width: 7px;[^}]*height: 7px;[^}]*border-radius: 999px;/);
assert.match(css, /\.notification-drawer-item\.level-success \.notification-status-dot \{[^}]*background: #4ade80;/);
assert.match(css, /\.notification-drawer-item\.level-warning \.notification-status-dot \{[^}]*background: #facc15;/);
assert.match(css, /\.notification-drawer-item\.level-(?:critical|danger)[^}]*\.notification-status-dot[^}]*background: #f87171;/);
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```powershell
node --test --test-name-pattern "digest drawer list|notification drawer preserves" apps/windows-electron/src/renderer/security.test.js
```

Expected: FAIL because the dot markup and styles do not exist and the 3px left border is still present.

- [ ] **Step 3: Add the decorative status dot to the source label**

Update the source row in `renderDigestDrawerList` to:

```js
<span><i class="notification-status-dot" aria-hidden="true"></i>${escapeHtml(sourceLabel?.(item.source) || item.source || "WinPlate")}</span>
```

- [ ] **Step 4: Replace the stripe rules with dot rules**

Keep `border: 1px solid var(--mail-glass-border)` and remove the `border-left` declaration and all `border-left-color` level overrides. Make the source label an inline flex row and add:

```css
.notification-drawer-item span { display: inline-flex; align-items: center; gap: 7px; color: var(--accent); font-size: 10px; font-weight: 800; letter-spacing: .12em; }
.notification-status-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 999px; background: #60a5fa; box-shadow: 0 0 10px rgba(96, 165, 250, .55); }
.notification-drawer-item.level-success .notification-status-dot { background: #4ade80; box-shadow: 0 0 10px rgba(74, 222, 128, .55); }
.notification-drawer-item.level-warning .notification-status-dot { background: #facc15; box-shadow: 0 0 10px rgba(250, 204, 21, .55); }
.notification-drawer-item.level-critical .notification-status-dot,
.notification-drawer-item.level-danger .notification-status-dot { background: #f87171; box-shadow: 0 0 10px rgba(248, 113, 113, .55); }
```

- [ ] **Step 5: Run focused and complete renderer tests**

Run:

```powershell
node --test --test-name-pattern "digest drawer list|notification drawer preserves" apps/windows-electron/src/renderer/security.test.js
node --test apps/windows-electron/src/renderer/security.test.js
npm run check:syntax --workspace @winplate/windows-electron
```

Expected: all commands exit with code 0.

- [ ] **Step 6: Review the final diff and commit only scoped files**

Run:

```powershell
git diff --check
git diff -- apps/windows-electron/src/renderer/components/notificationDigest.js apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js
git add -- apps/windows-electron/src/renderer/components/notificationDigest.js apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js
git commit -m "style: use status dots in notification drawer"
```

Expected: no whitespace errors; the commit contains only the three scoped renderer files.
