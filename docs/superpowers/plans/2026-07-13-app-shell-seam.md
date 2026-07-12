# App Shell Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Windows WinPlate page one continuous titlebar-to-sidebar surface and a shared, correctly aligned main-content corner.

**Architecture:** `renderMain()` will compute one sidebar state and put it on the outer window shell, so titlebar and workspace consume the same CSS width variable. Windows-only CSS will make the titlebar's left segment use the sidebar surface and will move the top-left content seam from the Settings exception to the common app shell.

**Tech Stack:** Vanilla JavaScript renderer, CSS custom properties, Node.js built-in test runner.

## Global Constraints

- Do not change weather, clock, native window controls, navigation, notification data, or page content.
- Apply the shared seam only to the Windows custom-titlebar path; macOS keeps its native-titlebar layout.
- Preserve the existing 224px expanded, 72px collapsed, and 286px Settings sidebar widths.
- Make one minimal shell change; do not refactor unrelated page layouts.

---

### Task 1: Specify the shared Windows shell seam in renderer coverage

**Files:**
- Modify: `apps/windows-electron/src/renderer/security.test.js:172-211`
- Test: `apps/windows-electron/src/renderer/security.test.js`

**Interfaces:**
- Consumes: `renderMain()` in `apps/windows-electron/src/renderer/app.js` and shell selectors in `apps/windows-electron/src/renderer/styles.css`.
- Produces: Regression coverage for shell state classes and the Windows-only shared seam contract.

- [ ] **Step 1: Write the failing test**

Add this test immediately after the custom-titlebar test:

```js
test("Windows app shell shares the titlebar/sidebar seam across page types", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const renderStart = renderer.indexOf("function renderMain()");
  const renderEnd = renderer.indexOf("\nfunction updateMainStatusDom", renderStart);
  const renderMain = renderer.slice(renderStart, renderEnd);

  assert.match(renderMain, /const shellSidebarState = currentSection === "Settings" \? "settings" : sidebarCollapsed \? "collapsed" : "expanded";/);
  assert.match(renderMain, /class="main-window-shell shell-sidebar-\$\{shellSidebarState\}"/);
  assert.match(css, /\.main-body\.platform-win32 \.main-window-shell\s*\{[^}]*--shell-sidebar-width:\s*224px/);
  assert.match(css, /\.main-body\.platform-win32 \.main-window-shell\.shell-sidebar-collapsed\s*\{[^}]*--shell-sidebar-width:\s*72px/);
  assert.match(css, /\.main-body\.platform-win32 \.main-window-shell\.shell-sidebar-settings\s*\{[^}]*--shell-sidebar-width:\s*286px/);
  assert.match(css, /\.main-body\.platform-win32 \.app-titlebar\s*\{[^}]*linear-gradient\(to right, var\(--shell-sidebar-bg\) 0 var\(--shell-sidebar-width\)/);
  assert.match(css, /\.main-body\.platform-win32 \.workspace\s*\{[^}]*grid-template-columns:\s*var\(--shell-sidebar-width\) minmax\(0, 1fr\)/);
  assert.match(css, /\.main-body\.platform-win32 \.main-content\s*\{[^}]*border-top:[^}]*border-left:[^}]*border-radius:\s*20px 0 0 0/);
  assert.doesNotMatch(css, /\.settings-workspace \.main-content\s*\{[^}]*border-radius/);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
npm run test:unit --workspace @winplate/windows-electron -- src/renderer/security.test.js
```

Expected: FAIL because `shellSidebarState` and the Windows-only shared seam selectors do not exist yet.

- [ ] **Step 3: Preserve the red state locally**

Do not commit a deliberately failing test. Keep it unstaged until Task 2 makes it pass.

### Task 2: Implement the single shared seam for Windows

**Files:**
- Modify: `apps/windows-electron/src/renderer/app.js:2980-3010`
- Modify: `apps/windows-electron/src/renderer/styles.css:493-572, 632-657`
- Test: `apps/windows-electron/src/renderer/security.test.js`

**Interfaces:**
- Consumes: `currentSection`, `sidebarCollapsed`, and the existing `.workspace`, `.sidebar`, and `.main-content` elements.
- Produces: `shell-sidebar-expanded`, `shell-sidebar-collapsed`, and `shell-sidebar-settings` outer-shell classes consumed by the CSS seam.

- [ ] **Step 1: Add the renderer shell-state contract**

Before `appRoot.innerHTML` in `renderMain()`, add:

```js
  const shellSidebarState = currentSection === "Settings"
    ? "settings"
    : sidebarCollapsed ? "collapsed" : "expanded";
```

Change the outer wrapper from:

```js
    <div class="main-window-shell">
```

to:

```js
    <div class="main-window-shell shell-sidebar-${shellSidebarState}">
```

- [ ] **Step 2: Move the seam to Windows shell variables**

Add Windows-only shell rules alongside the existing titlebar rules:

```css
.main-body.platform-win32 .main-window-shell {
  --shell-sidebar-width: 224px;
  --shell-sidebar-bg: var(--sidebar-bg);
  display: grid;
  grid-template-rows: 44px minmax(0, 1fr);
  min-height: 100vh;
  background: var(--main-bg);
}
.main-body.platform-win32 .main-window-shell.shell-sidebar-collapsed { --shell-sidebar-width: 72px; }
.main-body.platform-win32 .main-window-shell.shell-sidebar-settings {
  --shell-sidebar-width: 286px;
  --shell-sidebar-bg: var(--main-bg);
}
.main-body.platform-win32 .app-titlebar {
  border-bottom: 0;
  background: linear-gradient(to right, var(--shell-sidebar-bg) 0 var(--shell-sidebar-width), var(--main-bg) var(--shell-sidebar-width) 100%);
}
.main-body.platform-win32 .workspace {
  grid-template-columns: var(--shell-sidebar-width) minmax(0, 1fr);
  background: var(--shell-sidebar-bg);
}
.main-body.platform-win32 .main-content {
  border-top: 1px solid var(--border);
  border-left: 1px solid var(--border);
  border-radius: 20px 0 0 0;
  background: var(--main-bg);
}
```

Remove only fixed grid-width overrides that would beat these variables. Remove `border-top`, `border-left`, and `border-radius` from `.settings-workspace .main-content`; retain its settings-only background behavior.

- [ ] **Step 3: Run the focused test to verify it passes**

Run:

```powershell
npm run test:unit --workspace @winplate/windows-electron -- src/renderer/security.test.js
```

Expected: PASS, including `Windows app shell shares the titlebar/sidebar seam across page types`.

- [ ] **Step 4: Commit the green implementation**

```powershell
git add apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js
git commit -m "style: unify Windows app shell seam"
```

### Task 3: Validate renderer and repository integration

**Files:**
- Verify: `apps/windows-electron/src/renderer/app.js`
- Verify: `apps/windows-electron/src/renderer/styles.css`
- Verify: `apps/windows-electron/src/renderer/security.test.js`

**Interfaces:**
- Consumes: The green seam from Task 2.
- Produces: Evidence that syntax, focused behavior, and repository checks remain valid.

- [ ] **Step 1: Check static whitespace and renderer syntax**

Run:

```powershell
git diff --check
node --check apps/windows-electron/src/renderer/app.js
```

Expected: no output and exit code 0 from both commands.

- [ ] **Step 2: Run package-local validation**

Run:

```powershell
npm run check --workspace @winplate/windows-electron
```

Expected: exit code 0.

- [ ] **Step 3: Run the repository validation gate**

Run:

```powershell
npm run check
```

Expected: exit code 0. If an unrelated pre-existing failure appears, report its exact command and failure without modifying unrelated files.

- [ ] **Step 4: Inspect the actual shell states**

In the running Windows app, inspect Notifications, Settings, and the collapsed primary sidebar. Confirm the top-left main-content corner begins at the exact same x-coordinate as the sidebar boundary, with no extra titlebar divider, gap, or double rule.

