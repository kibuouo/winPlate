# WinPlate Multi-Platform Monorepo Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate Windows and macOS work on `main`, reorganize WinPlate into platform apps, shared packages, and a localhost-only backend, then retire the permanent macOS branch without losing behavior or history.

**Architecture:** Preserve behavior while moving code in testable commits. Platform lifecycle and UI stay under `apps`, deterministic rules move under `packages`, and external I/O plus SQLite stay under `backend/local-api`.

**Tech Stack:** Electron 40, Node.js 22 test runner, FastAPI, Python 3.12 unittest, SQLite, GitHub Actions, future SwiftUI/AppKit/iOS/watchOS clients.

---

## Target file map

- `apps/windows-electron/{src,assets,package.json}`: existing Electron application and Windows integrations.
- `apps/macos/electron-menubar/`: existing tested Electron macOS transition implementation.
- `apps/{macos,ios,watchos}/README.md`: platform boundaries and roadmap gates.
- `packages/core/{notification,digest,module-registry,usage-models}/`: pure business rules and colocated tests.
- `packages/shared-types/schemas/`: versioned cross-language JSON Schemas.
- `packages/icons/`: semantic icon keys and platform render mappings.
- `backend/local-api/winplate_local_api/`: importable FastAPI package and SQLite/cache behavior.
- `backend/local-api/tests/`: Python unit and contract tests.
- `package.json`: root workspace orchestration only.
- `.github/workflows/test.yml`: Windows/macOS validation.
- `docs/{architecture,notification-center,platform-roadmap}.md`: durable architecture documentation.

### Task 1: Integrate the macOS branch

**Files:**
- Modify on conflict only: `package.json`, `backend/main.py`, `backend/test_app.py`
- Modify on conflict only: `src/main/main.js`, `src/main/windows.js`, `src/renderer/app.js`
- Create: `docs/verification/macos-branch-integration.txt`

- [ ] **Step 1: Record ancestry and unique commits**

```powershell
git fetch origin --prune
git log --left-right --cherry-pick --oneline main...origin/codex/macos-menu-bar | Tee-Object docs/verification/macos-branch-integration.txt
```

Expected: the file records every commit unique to either side before integration.

- [ ] **Step 2: Merge without committing**

Run: `git merge --no-ff --no-commit origin/codex/macos-menu-bar`

Expected: a staged merge or explicit conflicts. Never resolve a conflict by deleting one platform wholesale.

- [ ] **Step 3: Resolve conflicts**

Retain the latest Windows notification/refresh fixes from `main` and the portable settings, macOS menu bar, cross-platform Python launcher, and dual-platform tests from the macOS branch.

Run: `rg -n '^(<<<<<<<|=======|>>>>>>>)' package.json backend src scripts .github`

Expected: no matches.

- [ ] **Step 4: Verify the merged baseline**

```powershell
npm ci
npm run check
npm run backend:test
```

Expected: all Node and Python tests pass before directory moves.

- [ ] **Step 5: Commit**

```powershell
git add .github package.json package-lock.json backend src scripts assets docs/verification
git commit -m "merge: integrate macOS menu bar into main"
```

### Task 2: Add workspaces and platform skeletons

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `scripts/workspaceLayout.test.js`
- Create: `apps/{macos,ios,watchos}/README.md`
- Create: `packages/{core,shared-types,icons}/package.json`

- [ ] **Step 1: Write the failing layout test**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('required monorepo boundaries exist', () => {
  for (const relativePath of [
    'apps/windows-electron', 'apps/macos', 'apps/ios', 'apps/watchos',
    'packages/core', 'packages/shared-types', 'packages/icons',
    'backend/local-api',
  ]) {
    assert.equal(fs.existsSync(path.resolve(relativePath)), true, relativePath);
  }
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test scripts/workspaceLayout.test.js`

Expected: FAIL naming `apps/windows-electron`.

- [ ] **Step 3: Create skeletons and workspace manifests**

Set root `package.json` to `"private": true` and add workspaces for `apps/windows-electron`, `apps/macos/electron-menubar`, and all three packages. Use private names `@winplate/windows-electron`, `@winplate/macos-electron-menubar`, `@winplate/core`, `@winplate/shared-types`, and `@winplate/icons`. Apple README files must state boundaries and the separate privacy/sync design gate.

- [ ] **Step 4: Verify and commit**

```powershell
npm install --package-lock-only
node --test scripts/workspaceLayout.test.js
git add package.json package-lock.json scripts apps packages backend/local-api
git commit -m "build: add multi-platform workspace skeleton"
```

### Task 3: Move Electron into the Windows app

**Files:**
- Move: `src/` to `apps/windows-electron/src/`
- Move: `assets/` to `apps/windows-electron/assets/`
- Create: `apps/windows-electron/package.json`
- Modify: root `package.json`
- Modify/Test: `apps/windows-electron/src/main/pythonService.js` and its test

- [ ] **Step 1: Add failing repository-path tests**

Add assertions to `pythonService.test.js` for repository-root discovery and the future backend entry `backend/local-api/winplate_local_api/main.py`. Add an asset-resolution assertion to the existing window/integration test.

- [ ] **Step 2: Move files with history**

```powershell
git mv src apps/windows-electron/src
git mv assets apps/windows-electron/assets
```

Expected: Git detects renames.

- [ ] **Step 3: Define commands**

Keep app-local `main: "src/main/main.js"`, syntax, unit, dev, and build commands. Root commands delegate by workspace. Root `check` runs Windows, macOS transition, core, shared-types, and icons tests; root `backend:test` discovers `backend/local-api/tests`.

- [ ] **Step 4: Centralize path resolution**

Create one repository-root helper based on `__dirname`; derive backend and asset paths from it. Do not scatter new relative traversal strings.

- [ ] **Step 5: Verify and commit**

```powershell
npm install --package-lock-only
npm run check
npm run backend:test
git diff --check
git add package.json package-lock.json apps scripts
git commit -m "refactor: move Electron app into platform workspace"
```

### Task 4: Package the localhost API

**Files:**
- Move: `backend/main.py` to `backend/local-api/winplate_local_api/main.py`
- Move: `backend/modules/` to `backend/local-api/winplate_local_api/modules/`
- Move: `backend/test_app.py` to `backend/local-api/tests/test_app.py`
- Move: `backend/{requirements.txt,logging.json}` to `backend/local-api/`
- Create: package and test `__init__.py` files
- Create: `backend/local-api/tests/test_package_boundary.py`
- Modify: Electron Python launcher and root scripts

- [ ] **Step 1: Write a failing import test**

```python
import unittest
from winplate_local_api.main import api

class PackageBoundaryTest(unittest.TestCase):
    def test_fastapi_app_remains_importable(self):
        self.assertEqual(api.title, "WinPlate Local API")
```

Run with `PYTHONPATH=backend/local-api`; expected: FAIL before the move.

- [ ] **Step 2: Move files and repair imports**

Use `git mv`. Convert package-internal imports to explicit relative imports. Keep endpoints, database names, cache rules, and port 8765 unchanged.

- [ ] **Step 3: Update exact commands**

Use `python -m uvicorn winplate_local_api.main:api --app-dir backend/local-api --host 127.0.0.1 --port 8765 --reload --log-config backend/local-api/logging.json`. Install from `backend/local-api/requirements.txt`. Electron must launch the new package while retaining loopback health polling.

- [ ] **Step 4: Verify and commit**

```powershell
$env:PYTHONPATH='backend/local-api'
node scripts/venvPython.js -m unittest discover -s backend/local-api/tests -p "test_*.py"
Remove-Item Env:PYTHONPATH
npm run check
git add backend apps/windows-electron scripts package.json package-lock.json
git commit -m "refactor: package localhost API under backend local-api"
```

### Task 5: Extract platform-neutral core rules

**Files:**
- Move pure notification rules to `packages/core/notification/`
- Move `digestEngine.js` and test to `packages/core/digest/`
- Move `moduleRegistry.js` and test to `packages/core/module-registry/`
- Move pure usage parsing/models to `packages/core/usage-models/`
- Create: `packages/core/architecture.test.js`
- Modify: Electron consumers and `packages/core/package.json`

- [ ] **Step 1: Write the boundary test**

Recursively inspect core JavaScript and fail on `require('electron')`, `node:fs`, SQLite libraries, `fastapi`, `SwiftUI`, or `AppKit`.

- [ ] **Step 2: Run the test against candidate modules**

Expected: platform-coupled candidates fail, showing which orchestration must stay in the app.

- [ ] **Step 3: Move only deterministic code**

For mixed files, leave I/O in Electron and extract transforms with explicit object inputs/outputs. Export stable package subpaths. Move existing behavior tests with the pure code without weakening assertions.

- [ ] **Step 4: Verify and commit**

```powershell
npm run test --workspace @winplate/core
npm run test:unit --workspace @winplate/windows-electron
git add packages/core apps/windows-electron package.json package-lock.json
git commit -m "refactor: extract platform-neutral core rules"
```

### Task 6: Add shared contracts and semantic icons

**Files:**
- Create: `packages/shared-types/schemas/{status-module,notification,usage}.v1.schema.json`
- Create: `packages/shared-types/schema.test.js`
- Move: semantic icon keys to `packages/icons/smartNotificationIconKeys.js`
- Move: Electron mapping to `packages/icons/electron/smartNotificationIcons.js`
- Create: `packages/icons/architecture.test.js`
- Modify: backend and Electron contract tests

- [ ] **Step 1: Write failing schema fixture tests**

Each schema gets one current valid fixture and one invalid fixture missing its discriminator/version. Tests require `additionalProperties`, required fields, and a literal schema version.

- [ ] **Step 2: Add minimal v1 schemas**

Model only fields currently produced or consumed and require `schemaVersion: 1`. Do not invent health fields.

- [ ] **Step 3: Separate semantic keys from render mappings**

Semantic keys remain platform-neutral. Electron mappings may use CSS/image names; SF Symbols mappings wait for native macOS implementation.

- [ ] **Step 4: Verify and commit**

```powershell
npm run test --workspace @winplate/shared-types
npm run test --workspace @winplate/icons
npm run check
npm run backend:test
git add packages apps/windows-electron backend/local-api package.json package-lock.json
git commit -m "feat: define shared contracts and semantic icons"
```

### Task 7: Isolate the existing macOS transition app

**Files:**
- Move: macOS-only Electron main/preload/renderer modules and tests to `apps/macos/electron-menubar/`
- Modify: `apps/macos/README.md`
- Modify: workspace commands

- [ ] **Step 1: Classify by dependency**

Electron menu APIs and menu-bar windows stay in the transition app. Pure models move to core. Cross-platform Electron startup remains in the Windows Electron workspace only until a separately designed shared shell exists.

- [ ] **Step 2: Move with history**

Use `git mv`, keeping tests beside implementation. Export only narrow adapters needed by the transition app.

- [ ] **Step 3: Preserve runnable tests**

The private `@winplate/macos-electron-menubar` workspace gets `test` and `check:syntax`. Tests must run on Windows through existing mocks without invoking macOS APIs.

- [ ] **Step 4: Verify and commit**

```powershell
npm install --package-lock-only
npm run check
npm run backend:test
git add apps/macos apps/windows-electron packages package.json package-lock.json
git commit -m "refactor: isolate macOS menu bar transition app"
```

### Task 8: Document and enforce the architecture

**Files:**
- Create: `docs/architecture.md`
- Create: `docs/notification-center.md`
- Create: `docs/platform-roadmap.md`
- Modify: `README.md`, `scripts/workspaceLayout.test.js`
- Create/Modify: `.github/workflows/test.yml`

- [ ] **Step 1: Extend documentation checks**

Assert the three docs exist and README links to each.

- [ ] **Step 2: Write exact content**

Architecture defines dependency direction and localhost security. Notification Center defines normalization, priority/color grading, deterministic digest fallback, and icon semantics. Roadmap identifies Windows Electron as current, Electron macOS as transition evidence, native macOS as next, and iOS/watchOS as privacy-gated.

- [ ] **Step 3: Update CI**

Use a `windows-latest`/`macos-latest` matrix, Node 22, and Python 3.12. Run `npm ci`, venv creation, backend install, `npm run check`, and `npm run backend:test`.

- [ ] **Step 4: Verify and commit**

```powershell
node --test scripts/workspaceLayout.test.js
npm run check
npm run backend:test
git diff --check
git add README.md docs .github scripts/workspaceLayout.test.js
git commit -m "docs: describe monorepo architecture and platform roadmap"
```

### Task 9: Accept, push, and retire the branch

**Files:**
- Modify: `docs/verification/macos-branch-integration.txt`
- Create: `docs/verification/monorepo-migration.md`

- [ ] **Step 1: Run complete acceptance**

```powershell
npm ci
npm run check
npm run backend:test
git status --short
```

Expected: all pass and the worktree is clean.

- [ ] **Step 2: Prove branch work is retained**

```powershell
git merge-base --is-ancestor origin/codex/macos-menu-bar main
git log --left-right --cherry-pick --oneline main...origin/codex/macos-menu-bar
```

Expected: ancestry exits 0 and there are no right-side (`>`) commits. Record results in `docs/verification/monorepo-migration.md`.

- [ ] **Step 3: Commit verification**

```powershell
git add docs/verification
git commit -m "docs: record monorepo migration acceptance"
```

- [ ] **Step 4: Push and require green CI**

```powershell
git push origin main
gh run list --branch main --limit 1
gh run watch --exit-status
```

Expected: both OS jobs pass.

- [ ] **Step 5: Delete the retired branch**

```powershell
git push origin --delete codex/macos-menu-bar
git fetch origin --prune
git branch -r
```

Expected: `origin/codex/macos-menu-bar` is absent and `origin/main` retains all work.

## Final verification checklist

- [ ] `main` contains both histories.
- [ ] Windows Electron runs from `apps/windows-electron` without regression.
- [ ] The local API imports from `backend/local-api`, listens only on loopback, and retains SQLite/cache behavior.
- [ ] Core has no platform or persistence dependencies.
- [ ] Contracts and icons have platform-neutral tests.
- [ ] macOS transition behavior remains tested and native boundaries are documented.
- [ ] iOS/watchOS contain documentation only with privacy/design gates.
- [ ] Windows and macOS CI pass on `main`.
- [ ] The remote macOS branch is deleted only after all prior checks pass.

