# Sidebar Codex SVG Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the prior monochrome Codex SVG only in the main application sidebar.

**Architecture:** Keep `codexIcon` as the shared colored notification/page asset. Define a second `sidebarCodexIcon` constant using the exact historical inline SVG, and route only the `Codex` navigation entry to that constant.

**Tech Stack:** Electron renderer JavaScript and Node.js built-in test runner.

## Global Constraints

- Change only the main application sidebar Codex icon.
- Preserve the shared colored Codex icon in notifications and page-level content.
- Reuse the exact pre-`59123f5` SVG paths.
- Validate through the Windows Electron package test and syntax commands.

---

### Task 1: Restore the sidebar-only historical SVG

**Files:**
- Modify: `apps/windows-electron/src/renderer/security.test.js`
- Modify: `apps/windows-electron/src/renderer/app.js:1209,3022`

**Interfaces:**
- Consumes: existing `codexIcon` and the sidebar `sections.map` renderer.
- Produces: `sidebarCodexIcon`, used only for `item === "Codex"` in the main sidebar.

- [x] **Step 1: Write the failing regression test**

Add these source assertions to the existing renderer layout test:

```js
assert.match(renderer, /const sidebarCodexIcon = `\s*<svg class="codex-icon" viewBox="0 0 24 24" aria-hidden="true">\s*<path d="M7\.25 18\.25h9\.5a4\.25 4\.25 0 0 0 \.64-8\.45A5\.75 5\.75 0 0 0 6\.5 7\.85a3\.75 3\.75 0 0 0 \.75 7\.42"\/>\s*<path d="m8\.25 10\.25 2\.25 2\.25-2\.25 2\.25M12\.75 14\.75h3"\/>\s*<\/svg>`;/);
assert.match(renderMain, /item === "Codex" \? sidebarCodexIcon : item === "Mail"/);
assert.match(renderer, /const codexIcon = `\s*<svg class="codex-icon"[\s\S]*?SMART_NOTIFICATION_ICON_REGISTRY\.codex/);
```

- [x] **Step 2: Run the focused test to verify it fails**

Run from `apps/windows-electron`:

```powershell
node --test src/renderer/security.test.js
```

Expected: the test fails because there is no `sidebarCodexIcon` and the sidebar still uses the shared colored `codexIcon`.

- [x] **Step 3: Implement the sidebar-only SVG routing**

Define the historical SVG next to `codexIcon`:

```js
const sidebarCodexIcon = `
  <svg class="codex-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7.25 18.25h9.5a4.25 4.25 0 0 0 .64-8.45A5.75 5.75 0 0 0 6.5 7.85a3.75 3.75 0 0 0 .75 7.42"/>
    <path d="m8.25 10.25 2.25 2.25-2.25 2.25M12.75 14.75h3"/>
  </svg>`;
```

In the main sidebar navigation expression, replace the Codex branch with:

```js
item === "Codex" ? sidebarCodexIcon : item === "Mail"
```

- [x] **Step 4: Re-run the focused test to verify it passes**

Run from `apps/windows-electron`:

```powershell
node --test src/renderer/security.test.js
```

Expected: PASS, including the historical-path and sidebar-routing assertions.

- [x] **Step 5: Run package verification and inspect the diff**

Run from `apps/windows-electron`:

```powershell
npm run test:unit
npm run check:syntax
```

Then run from the repository root:

```powershell
git diff --check
git diff -- apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/security.test.js
```

Expected: all tests and syntax checks pass; the diff adds only the sidebar-specific SVG and regression coverage without changing the shared `codexIcon`.
