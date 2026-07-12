# Settings Sidebar State Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Settings from inheriting the collapsed application-sidebar layout while preserving that layout after the user returns to an application page.

**Architecture:** `sidebarCollapsed` remains the single source of truth for application pages. The Settings workspace receives its dedicated `settings-workspace` class but no `sidebar-collapsed` class, so generic compact sidebar selectors cannot alter its navigation. A source-level renderer regression test protects the conditional class expression.

**Tech Stack:** Electron renderer JavaScript, CSS, Node.js built-in test runner.

## Global Constraints

- Keep normal application sidebar collapse/expand behavior unchanged.
- Keep the persisted in-memory `sidebarCollapsed` value unchanged while Settings is open.
- Do not change settings data, navigation targets, or platform behavior.
- Validate with the Windows Electron package commands, not a nonexistent root `npm test` command.

---

### Task 1: Isolate the Settings workspace from application-only collapsed classes

**Files:**
- Modify: `apps/windows-electron/src/renderer/security.test.js`
- Modify: `apps/windows-electron/src/renderer/app.js:3009`

**Interfaces:**
- Consumes: `currentSection` and `sidebarCollapsed` from `renderMain()`.
- Produces: a workspace class string containing `settings-workspace` for Settings, and `sidebar-collapsed` only for collapsed non-Settings sections.

- [x] **Step 1: Write the failing regression test**

Add this assertion to the existing Windows shell renderer test in `apps/windows-electron/src/renderer/security.test.js`:

```js
assert.match(
  renderMain,
  /class="workspace \$\{currentSection === "Settings" \? "settings-workspace" : ""\} \$\{currentSection !== "Settings" && sidebarCollapsed \? "sidebar-collapsed" : ""\}"/
);
```

- [x] **Step 2: Run the focused test to verify it fails**

Run from `apps/windows-electron`:

```powershell
node --test src/renderer/security.test.js
```

Expected: the renderer shell test fails because `renderMain()` currently adds `sidebar-collapsed` whenever `sidebarCollapsed` is true, including when `currentSection === "Settings"`.

- [x] **Step 3: Implement the minimal renderer change**

Replace the workspace class expression in `apps/windows-electron/src/renderer/app.js` with:

```js
<div class="workspace ${currentSection === "Settings" ? "settings-workspace" : ""} ${currentSection !== "Settings" && sidebarCollapsed ? "sidebar-collapsed" : ""}">
```

This leaves `sidebarCollapsed` intact; it only prevents generic collapsed CSS from applying to Settings.

- [x] **Step 4: Re-run the focused test to verify it passes**

Run from `apps/windows-electron`:

```powershell
node --test src/renderer/security.test.js
```

Expected: PASS, including the new Settings-specific assertion.

- [x] **Step 5: Run the package validation suite**

Run from `apps/windows-electron`:

```powershell
npm run test:unit
npm run check:syntax
```

Expected: both commands exit successfully with no syntax errors or test failures.

- [x] **Step 6: Review the final diff before committing**

Run:

```powershell
git diff --check
git diff -- apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/security.test.js
```

Expected: the diff is limited to the regression assertion and the Settings-specific conditional class. Do not commit unrelated pre-existing work.
