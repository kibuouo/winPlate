# Capsule GitHub Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route activation of the floating capsule's GitHub item to the GitHub section in the main WinPlate window.

**Architecture:** Reuse the existing renderer-to-main `showMainWindow(section)` bridge and existing `main:navigate` delivery. Only the floating capsule's two GitHub activation handlers change; main-window profile controls retain their external-profile IPC path.

**Tech Stack:** Electron, renderer JavaScript, Node.js built-in test runner.

## Global Constraints

- Change only the floating capsule GitHub interaction; `data-open-github` controls continue opening the external GitHub profile.
- Preserve mouse and keyboard activation parity.
- Add no IPC channel or dependency.

---

### Task 1: Route capsule GitHub activation to main-window navigation

**Files:**
- Modify: `apps/windows-electron/src/renderer/security.test.js:1337-1351`
- Modify: `apps/windows-electron/src/renderer/app.js:1579-1669`

**Interfaces:**
- Consumes: `window.winplate.showMainWindow(section)` from `apps/windows-electron/src/preload/preload.js`.
- Produces: Click, Enter, and Space activation of `.github-module` send `"GitHub"` to the existing main-window navigation bridge.

- [ ] **Step 1: Write the failing test**

  Extend the existing renderer-source test with these assertions:

  ```js
  assert.match(renderer, /aria-label="Open GitHub section"/);
  assert.match(renderer, /githubModule\.addEventListener\("click", \(\) => window\.winplate\.showMainWindow\("GitHub"\)\);/);
  assert.match(renderer, /event\.preventDefault\(\);\s*window\.winplate\.showMainWindow\("GitHub"\);/);
  assert.doesNotMatch(
    capsuleGithubControls,
    /openGithubProfile/
  );
  ```

  Define `capsuleGithubControls` by slicing `renderer` from `const githubModule = document.querySelector(".github-module");` through the subsequent GitHub keyboard-handler closing brace, so the assertion does not prohibit main-window external profile controls.

- [ ] **Step 2: Run the focused test to verify it fails**

  Run:

  ```powershell
  node --test --test-name-pattern="capsule GitHub" apps/windows-electron/src/renderer/security.test.js
  ```

  Expected: FAIL because the capsule still has the profile label and calls `openGithubProfile`.

- [ ] **Step 3: Write the minimal implementation**

  In both floating-capsule render templates, replace:

  ```html
  aria-label="Open GitHub profile"
  ```

  with:

  ```html
  aria-label="Open GitHub section"
  ```

  In `renderFloating()`, replace both activation calls with:

  ```js
  window.winplate.showMainWindow("GitHub");
  ```

  Do not change `bindGithubControls()` or the `github:open-profile` main-process handler.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run:

  ```powershell
  node --test --test-name-pattern="capsule GitHub" apps/windows-electron/src/renderer/security.test.js
  ```

  Expected: PASS.

- [ ] **Step 5: Run the Windows Electron unit suite**

  Run:

  ```powershell
  npm run test:unit --workspace @winplate/windows-electron
  ```

  Expected: all tests pass.

- [ ] **Step 6: Commit**

  ```powershell
  git add apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/security.test.js
  git commit -m "fix: route capsule GitHub to main section"
  ```
