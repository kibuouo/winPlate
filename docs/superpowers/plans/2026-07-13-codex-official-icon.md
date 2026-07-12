# Codex 官方图标 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every WinPlate Codex code or terminal glyph with one local, official-style blue-purple cloud icon and white command prompt.

**Architecture:** The `codex` semantic key joins the shared icon whitelist and is rendered by both the Node package registry and its browser fallback. Renderer code maps Codex notification sources to that key and builds the module glyph from the same registry body, so visual geometry has one source of truth.

**Tech Stack:** Node.js, Electron renderer, inline SVG, `node:test`.

## Global Constraints

- Keep the existing `code` and `terminal` keys available for non-Codex notifications.
- Do not add remote assets, runtime fetches, dependencies, or external SVG files.
- Preserve notification layout, interactions, accessibility attributes, and the user’s existing uncommitted Settings work.
- The Codex body uses a blue-purple gradient cloud and white command prompt; it does not inherit the surrounding theme color.

---

### Task 1: Register the official-style Codex semantic icon

**Files:**
- Modify: `packages/icons/smartNotificationIconKeys.js:1-8`
- Modify: `apps/windows-electron/src/shared/smartNotificationIconKeys.js:7-14`
- Modify: `packages/icons/electron/smartNotificationIcons.js:8-96`
- Modify: `apps/windows-electron/src/renderer/icons/smartNotificationIcons.js:8-97`
- Test: `apps/windows-electron/src/renderer/icons/smartNotificationIcons.test.js:10-47`

**Interfaces:**
- Consumes: `ICON_KEYS`, `normalizeSmartNotificationIconKey`, and the browser fallback loaded by `index.html`.
- Produces: the whitelisted `codex` key, `SMART_NOTIFICATION_ICON_REGISTRY.codex`, and `resolveSmartNotificationIcon({ source: "codex" }) === "codex"`.

- [ ] **Step 1: Write the failing registry and source-default tests**

  Update the expected key count from `31` to `32`. Add the following assertions after the generic whitelist loop, then update the existing Codex source expectation.

  ```js
  const codexSvg = renderSmartNotificationIcon("codex");
  assert.match(codexSvg, /data-icon-key="codex"/);
  assert.match(codexSvg, /<linearGradient id="codex-icon-gradient"/);
  assert.match(codexSvg, /stop-color="#5b5ce2"/);
  assert.match(codexSvg, /stroke="#fff"/);
  assert.equal(resolveSmartNotificationIcon({ title: "普通动态", source: "codex" }), "codex");
  ```

  Change the generic color assertion so it excludes `codex`; all other keys must remain colorless and inherit `currentColor`.

- [ ] **Step 2: Run the focused test to verify it fails**

  Run:

  ```powershell
  node --test src/renderer/icons/smartNotificationIcons.test.js
  ```

  Expected: FAIL because `codex` is absent from `ICON_KEYS` and the source default still resolves to `terminal`.

- [ ] **Step 3: Add the mirrored whitelist entry and SVG body**

  Insert `"codex"` immediately after `"terminal"` in both whitelist arrays. Add the same `codex` body to both `ICON_BODIES` objects:

  ```js
  codex: '<defs><linearGradient id="codex-icon-gradient" x1="5" y1="4" x2="19" y2="20" gradientUnits="userSpaceOnUse"><stop stop-color="#5b5ce2"></stop><stop offset=".55" stop-color="#4f8ff7"></stop><stop offset="1" stop-color="#8b5cf6"></stop></linearGradient></defs><path d="M7.5 18.5h9.25a4.25 4.25 0 0 0 .64-8.45A5.75 5.75 0 0 0 6.5 8.1a3.75 3.75 0 0 0 1 7.4Z" fill="url(#codex-icon-gradient)" stroke="none"></path><path d="m8.9 10.6 2.2 1.9-2.2 1.9M13.2 14.4h2.8" fill="none" stroke="#fff" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"></path>'
  ```

  In both registries, change the `/Codex/i` rule and the `codex` source default from `"terminal"` to `"codex"`.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run:

  ```powershell
  node --test src/renderer/icons/smartNotificationIcons.test.js
  ```

  Expected: PASS; the 32-key registry is complete and Codex resolves to the gradient icon.

- [ ] **Step 5: Commit the semantic icon registry**

  ```powershell
  git add packages/icons/smartNotificationIconKeys.js packages/icons/electron/smartNotificationIcons.js apps/windows-electron/src/shared/smartNotificationIconKeys.js apps/windows-electron/src/renderer/icons/smartNotificationIcons.js apps/windows-electron/src/renderer/icons/smartNotificationIcons.test.js
  git commit -m "feat: add official Codex notification icon"
  ```

### Task 2: Route every renderer Codex surface to the shared icon

**Files:**
- Modify: `apps/windows-electron/src/renderer/app.js:1033-1035,1209-1214`
- Modify: `apps/windows-electron/src/renderer/security.test.js:1565-1585`
- Test: `apps/windows-electron/src/renderer/security.test.js:1565-1585`

**Interfaces:**
- Consumes: `window.WinPlateSmartNotificationIcons.SMART_NOTIFICATION_ICON_REGISTRY.codex` from Task 1.
- Produces: `notificationSourceIconKey("codex") === "codex"` and a `codexIcon` SVG that embeds the shared body.

- [ ] **Step 1: Write failing renderer-source assertions**

  Add a focused test beside the notification timeline test that reads `app.js` and asserts the two source bindings:

  ```js
  test("Codex surfaces use the shared official icon body", () => {
    const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
    assert.match(renderer, /codex:\s*"codex"/);
    assert.match(renderer, /const codexIcon = `\s*<svg class="codex-icon"[^>]*>\s*\$\{window\.WinPlateSmartNotificationIcons\.SMART_NOTIFICATION_ICON_REGISTRY\.codex\}/);
    assert.doesNotMatch(renderer, /const codexIcon = `[^`]*m8\.25 10\.25/i);
  });
  ```

- [ ] **Step 2: Run the focused renderer test to verify it fails**

  Run:

  ```powershell
  node --test src/renderer/security.test.js
  ```

  Expected: FAIL because the current source mapping is `codex: "code"` and `codexIcon` contains its own cloud-code paths.

- [ ] **Step 3: Replace direct and notification mappings with the shared body**

  Change `notificationSourceIconKey` to map `codex` to `"codex"`. Replace the direct icon literal with:

  ```js
  const codexIcon = `
    <svg class="codex-icon" viewBox="0 0 24 24" aria-hidden="true">
      ${window.WinPlateSmartNotificationIcons.SMART_NOTIFICATION_ICON_REGISTRY.codex}
    </svg>`;
  ```

  Do not change `.codex-icon` size rules or the existing notification source container styles.

- [ ] **Step 4: Run renderer tests and syntax checking**

  Run:

  ```powershell
  node --test src/renderer/icons/smartNotificationIcons.test.js src/renderer/security.test.js
  npm run check:syntax --workspace @winplate/windows-electron
  ```

  Expected: both test files PASS and `check:syntax` exits 0.

- [ ] **Step 5: Commit only the Codex renderer change**

  ```powershell
  git add -p -- apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/security.test.js
  git commit -m "feat: use official Codex icon across renderer"
  ```

  Stage only the Codex hunks. Leave the user's Settings hunks in these same files unstaged.

### Task 3: Verify the full Electron package without altering unrelated work

**Files:**
- Verify only: `apps/windows-electron/package.json`

**Interfaces:**
- Consumes: the completed shared registry and renderer mappings.
- Produces: evidence that package syntax and unit tests pass.

- [ ] **Step 1: Inspect the Codex-only diff before verification**

  Run:

  ```powershell
  git diff --check
  git diff -- packages/icons apps/windows-electron/src/shared/smartNotificationIconKeys.js apps/windows-electron/src/renderer/icons/smartNotificationIcons.js apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/security.test.js
  ```

  Expected: no whitespace errors; the pre-existing Settings changes remain outside the icon hunks.

- [ ] **Step 2: Run the package validation gate**

  Run:

  ```powershell
  npm run check --workspace @winplate/windows-electron
  ```

  Expected: `check:syntax`, `test:unit`, and `test:python-service` all exit 0.

- [ ] **Step 3: Report the exact verification result**

  Report which test commands passed, which files were changed, and any pre-existing uncommitted paths deliberately left untouched.
