# WinPlate macOS Menu Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native macOS menu bar item that shows the WinPlate icon and current temperature and opens a compact Codex, DeepSeek, and weather panel, while preserving Windows behavior and never creating a macOS desktop floating capsule.

**Architecture:** Keep the existing FastAPI and usage readers unchanged. Add pure, testable modules for temperature/position normalization and panel-state reduction, then wrap Electron Tray/BrowserWindow behavior in a macOS-only controller with injected dependencies. Give the menu panel its own renderer and expose only narrow IPC methods through the existing sandboxed preload bridge.

**Tech Stack:** Electron 40, CommonJS, browser JavaScript/CSS, Node.js test runner, existing FastAPI backend, QWeather icon package.

---

## File responsibilities

- `src/main/menuBarState.js`: pure temperature-title and panel-bounds normalization.
- `src/main/menuBarState.test.js`: boundary coverage for temperature and multi-display placement.
- `src/shared/menuBarModel.js`: pure cached/failed-source reduction for panel data.
- `src/shared/menuBarModel.test.js`: normal, unconfigured, cached, and offline model tests.
- `src/main/macMenuBar.js`: macOS Tray, right-click menu, BrowserWindow panel, and lifecycle controller.
- `src/main/macMenuBar.test.js`: Electron-fake tests for native event dispatch and idempotent teardown.
- `src/main/startupPolicy.js`: pure platform startup decision; macOS explicitly disables the floating window.
- `src/main/startupPolicy.test.js`: Windows preservation and macOS no-capsule tests.
- `src/renderer/menubar.html`: accessible, fixed-order panel markup and CSP.
- `src/renderer/menubar.css`: native-material panel styling, neutral quota bars, and Windows status points.
- `src/renderer/menubar.js`: 30-second refresh, in-place DOM updates, actions, and Escape behavior.
- `src/preload/preload.js`: narrow menu-bar temperature, hide, and refresh-event bridge.
- `src/main/main.js`: platform startup orchestration and validated menu-bar IPC.
- `package.json`: cross-platform development command plus syntax/test registration.
- `README.md`: macOS development and menu-bar behavior.

### Task 1: Cross-platform development baseline

**Files:**
- Modify: `package.json:4-14`
- Modify: `README.md:1-30`

- [ ] **Step 1: Verify the current baseline**

Run:

```bash
npm run check
```

Expected: all existing syntax checks and Node tests pass before feature work.

- [ ] **Step 2: Make the development command portable**

Change the package description and `dev` script to:

```json
{
  "description": "A native status center for Windows and macOS built with Electron.",
  "scripts": {
    "dev": "cross-env FORCE_COLOR=1 electron ."
  }
}
```

Keep every other script and dependency unchanged.

- [ ] **Step 3: Document macOS setup and startup behavior**

Replace the README development opening with:

~~~~markdown
## Development

macOS:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm install
npm run dev
```

Windows PowerShell:

```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm install
npm run dev
```

Windows starts with the existing desktop capsule. macOS starts from one menu bar item and does not create a desktop floating capsule.
~~~~

- [ ] **Step 4: Verify metadata and commit**

Run:

```bash
npm pkg get description scripts.dev
npm run check
git add package.json README.md
git commit -m "chore: support macOS development startup"
```

Expected: the portable Electron command is printed and the existing checks pass.

### Task 2: Pure menu bar title and panel placement

**Files:**
- Create: `src/main/menuBarState.test.js`
- Create: `src/main/menuBarState.js`

- [ ] **Step 1: Write failing normalization and placement tests**

Create `src/main/menuBarState.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_PANEL_SIZE,
  formatTemperatureTitle,
  getMenuBarPanelBounds
} = require("./menuBarState");

test("formats a bounded whole-number temperature title", () => {
  assert.equal(formatTemperatureTitle(25.6), "26°C");
  assert.equal(formatTemperatureTitle("-4.6"), "-5°C");
  assert.equal(formatTemperatureTitle(140), "99°C");
  assert.equal(formatTemperatureTitle(-140), "-99°C");
  assert.equal(formatTemperatureTitle("not-a-number"), "--°");
  assert.equal(formatTemperatureTitle(null), "--°");
});

test("centers the preferred panel below the status item", () => {
  assert.deepEqual(getMenuBarPanelBounds(
    { x: 600, y: 0, width: 24, height: 24 },
    { x: 0, y: 24, width: 1440, height: 876 }
  ), { x: 452, y: 32, width: 320, height: 420 });
  assert.deepEqual(DEFAULT_PANEL_SIZE, { width: 320, height: 420 });
});

test("clamps the panel at both horizontal edges and negative displays", () => {
  assert.deepEqual(getMenuBarPanelBounds(
    { x: 4, y: 0, width: 20, height: 24 },
    { x: 0, y: 24, width: 1024, height: 744 }
  ), { x: 8, y: 32, width: 320, height: 420 });
  assert.deepEqual(getMenuBarPanelBounds(
    { x: -40, y: -900, width: 24, height: 24 },
    { x: -1280, y: -876, width: 1280, height: 876 }
  ), { x: -328, y: -868, width: 320, height: 420 });
});

test("shrinks panel height for a short work area", () => {
  assert.deepEqual(getMenuBarPanelBounds(
    { x: 400, y: 0, width: 24, height: 24 },
    { x: 0, y: 24, width: 800, height: 300 }
  ), { x: 252, y: 32, width: 320, height: 284 });
});
```

- [ ] **Step 2: Run the tests and confirm the missing-module failure**

Run:

```bash
node --test src/main/menuBarState.test.js
```

Expected: FAIL with `Cannot find module './menuBarState'`.

- [ ] **Step 3: Implement the pure state helpers**

Create `src/main/menuBarState.js`:

```js
const DEFAULT_PANEL_SIZE = Object.freeze({ width: 320, height: 420 });
const PANEL_INSET = 8;

function formatTemperatureTitle(value) {
  if (value === null || value === undefined || value === "") return "--°";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--°";
  const bounded = Math.max(-99, Math.min(99, Math.round(numeric)));
  return `${bounded}°C`;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}

function getMenuBarPanelBounds(trayBounds, workArea) {
  const width = Math.min(DEFAULT_PANEL_SIZE.width, workArea.width - PANEL_INSET * 2);
  const height = Math.min(DEFAULT_PANEL_SIZE.height, workArea.height - PANEL_INSET * 2);
  const minimumX = workArea.x + PANEL_INSET;
  const maximumX = workArea.x + workArea.width - width - PANEL_INSET;
  const minimumY = workArea.y + PANEL_INSET;
  const maximumY = workArea.y + workArea.height - height - PANEL_INSET;
  const centeredX = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
  const belowY = Math.round(trayBounds.y + trayBounds.height + PANEL_INSET);
  return {
    x: clamp(centeredX, minimumX, maximumX),
    y: clamp(belowY, minimumY, maximumY),
    width,
    height
  };
}

module.exports = {
  DEFAULT_PANEL_SIZE,
  PANEL_INSET,
  formatTemperatureTitle,
  getMenuBarPanelBounds
};
```

- [ ] **Step 4: Register and run the focused tests**

Run:

```bash
node --check src/main/menuBarState.js
node --test src/main/menuBarState.test.js
npm run check
```

Expected: the four new tests and the full check command pass.

- [ ] **Step 5: Commit the helpers**

```bash
git add src/main/menuBarState.js src/main/menuBarState.test.js
git commit -m "feat: normalize macOS menu bar state"
```

### Task 3: Cached panel data model without quota warnings

**Files:**
- Create: `src/shared/menuBarModel.test.js`
- Create: `src/shared/menuBarModel.js`

- [ ] **Step 1: Write failing model tests**

Create `src/shared/menuBarModel.test.js` with these cases:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { EMPTY_PANEL_STATE, reducePanelState } = require("./menuBarModel");

const success = (value) => ({ ok: true, value });
const failure = (message) => ({ ok: false, error: message });

test("maps current Codex, DeepSeek, and weather data", () => {
  const state = reducePanelState(EMPTY_PANEL_STATE, {
    codex: success({
      status: "Normal",
      windows: {
        fiveHour: { remainingPct: 60, resetText: "16:07" },
        sevenDay: { remainingPct: 59, resetText: "7月6日" }
      },
      updatedAt: 100
    }),
    deepseek: success({
      status: "Normal",
      balances: [{ currency: "CNY", totalBalance: "55.55" }],
      updatedAt: 101
    }),
    status: success({
      weather: { source: "qweather", temperature: 26, condition: "多云", location: "上海", icon: "101", updatedAt: 102 }
    })
  });

  assert.equal(state.codex.active, true);
  assert.equal(state.codex.fiveHour.remainingPct, 60);
  assert.equal(state.codex.sevenDay.remainingPct, 59);
  assert.equal(state.deepseek.active, true);
  assert.equal(state.deepseek.balance, "55.55");
  assert.equal(state.weather.available, true);
  assert.equal(state.weather.temperature, 26);
});

test("preserves cached values and marks only failed sources inactive", () => {
  const previous = reducePanelState(EMPTY_PANEL_STATE, {
    codex: success({ status: "Normal", windows: { fiveHour: { remainingPct: 60 }, sevenDay: { remainingPct: 59 } }, updatedAt: 100 }),
    deepseek: success({ status: "Normal", balances: [{ currency: "CNY", totalBalance: "55.55" }], updatedAt: 101 }),
    status: success({ weather: { source: "qweather", temperature: 26, condition: "多云", updatedAt: 102 } })
  });
  const state = reducePanelState(previous, {
    codex: failure("Codex unavailable"),
    deepseek: success({ status: "Normal", balances: [{ currency: "CNY", totalBalance: "53.20" }], updatedAt: 200 }),
    status: failure("offline")
  });

  assert.equal(state.codex.active, false);
  assert.equal(state.codex.fiveHour.remainingPct, 60);
  assert.equal(state.deepseek.balance, "53.20");
  assert.equal(state.weather.available, false);
  assert.equal(state.weather.temperature, 26);
});

test("clears fabricated balance for an explicitly unconfigured DeepSeek source", () => {
  const state = reducePanelState(EMPTY_PANEL_STATE, {
    deepseek: success({ status: "Unconfigured", balances: [] })
  });
  assert.equal(state.deepseek.active, false);
  assert.equal(state.deepseek.balance, null);
  assert.equal(state.deepseek.status, "Unconfigured");
});

test("returns stable empty states when all sources fail", () => {
  const state = reducePanelState(EMPTY_PANEL_STATE, {
    codex: failure("offline"),
    deepseek: failure("offline"),
    status: failure("offline")
  });
  assert.equal(state.codex.fiveHour.remainingPct, null);
  assert.equal(state.deepseek.balance, null);
  assert.equal(state.weather.temperature, null);
});
```

- [ ] **Step 2: Run the tests and confirm the missing-module failure**

```bash
node --test src/shared/menuBarModel.test.js
```

Expected: FAIL with `Cannot find module './menuBarModel'`.

- [ ] **Step 3: Implement the panel reducer**

Create `src/shared/menuBarModel.js` with this public shape:

```js
const EMPTY_WINDOW = Object.freeze({ remainingPct: null, resetText: "--", updatedAt: null });
const EMPTY_PANEL_STATE = Object.freeze({
  codex: Object.freeze({ active: false, status: "Unavailable", fiveHour: EMPTY_WINDOW, sevenDay: EMPTY_WINDOW, updatedAt: null }),
  deepseek: Object.freeze({ active: false, status: "Unconfigured", balance: null, updatedAt: null }),
  weather: Object.freeze({ available: false, temperature: null, condition: "天气不可用", location: "", icon: null, updatedAt: null })
});

function copyWindow(value, fallback) {
  const rawPercent = value?.remainingPct;
  const hasPercent = rawPercent !== null
    && rawPercent !== undefined
    && rawPercent !== ""
    && Number.isFinite(Number(rawPercent));
  return {
    remainingPct: hasPercent ? Math.max(0, Math.min(100, Number(rawPercent))) : fallback.remainingPct,
    resetText: typeof value?.resetText === "string" && value.resetText.trim() ? value.resetText.trim() : fallback.resetText,
    updatedAt: value?.updatedAt ?? fallback.updatedAt
  };
}

function reducePanelState(previous = EMPTY_PANEL_STATE, results = {}) {
  const next = {
    codex: { ...previous.codex, fiveHour: { ...previous.codex.fiveHour }, sevenDay: { ...previous.codex.sevenDay } },
    deepseek: { ...previous.deepseek },
    weather: { ...previous.weather }
  };

  if (results.codex?.ok) {
    const value = results.codex.value || {};
    const active = value.status !== "Unavailable";
    next.codex = {
      active,
      status: active ? "Normal" : "Unavailable",
      fiveHour: copyWindow(value.windows?.fiveHour, next.codex.fiveHour),
      sevenDay: copyWindow(value.windows?.sevenDay, next.codex.sevenDay),
      updatedAt: value.updatedAt ?? next.codex.updatedAt
    };
  } else if (results.codex) {
    next.codex.active = false;
    next.codex.status = "Unavailable";
  }

  if (results.deepseek?.ok) {
    const value = results.deepseek.value || {};
    const balance = Array.isArray(value.balances)
      ? value.balances.find((entry) => entry.currency === "CNY")?.totalBalance ?? null
      : null;
    next.deepseek = {
      active: value.status === "Normal",
      status: value.status || "Unavailable",
      balance,
      updatedAt: value.updatedAt ?? next.deepseek.updatedAt
    };
  } else if (results.deepseek) {
    next.deepseek.active = false;
    next.deepseek.status = "Unavailable";
  }

  if (results.status?.ok) {
    const weather = results.status.value?.weather || {};
    const available = weather.source === "qweather" && Number.isFinite(Number(weather.temperature));
    next.weather = {
      available,
      temperature: available ? Number(weather.temperature) : null,
      condition: typeof weather.condition === "string" && weather.condition ? weather.condition : "天气不可用",
      location: typeof weather.location === "string" ? weather.location : "",
      icon: /^\d{3}$/.test(String(weather.icon || "")) ? String(weather.icon) : null,
      updatedAt: weather.updatedAt ?? next.weather.updatedAt
    };
  } else if (results.status) {
    next.weather.available = false;
  }

  return next;
}

const api = { EMPTY_PANEL_STATE, reducePanelState };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.WinPlateMenuBarModel = api;
```

- [ ] **Step 4: Register, verify, and commit**

```bash
node --check src/shared/menuBarModel.js
node --test src/shared/menuBarModel.test.js
npm run check
git add src/shared/menuBarModel.js src/shared/menuBarModel.test.js
git commit -m "feat: reduce macOS menu panel data"
```

Expected: model tests and the full repository checks pass.

### Task 4: Testable native macOS menu bar controller

**Files:**
- Create: `src/main/macMenuBar.test.js`
- Create: `src/main/macMenuBar.js`

- [ ] **Step 1: Write failing native-controller tests**

Create `src/main/macMenuBar.test.js` with injected fakes for every Electron dependency:

```js
const { EventEmitter } = require("node:events");
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMacMenuBar } = require("./macMenuBar");

function createHarness() {
  const trays = [];
  const windows = [];
  const images = [];
  const actionCalls = [];

  class FakeTray extends EventEmitter {
    constructor(image) {
      super();
      this.image = image;
      this.title = "";
      this.popupCount = 0;
      this.destroyCount = 0;
      trays.push(this);
    }
    setToolTip(value) { this.toolTip = value; }
    setTitle(value) { this.title = value; }
    getBounds() { return { x: 600, y: 0, width: 24, height: 24 }; }
    popUpContextMenu(menu) { this.menu = menu; this.popupCount += 1; }
    destroy() { this.destroyCount += 1; }
  }

  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.visible = false;
      this.destroyed = false;
      this.webContents = { sent: [], send: (...args) => this.webContents.sent.push(args) };
      windows.push(this);
    }
    loadFile(value) { this.loadedFile = value; }
    isVisible() { return this.visible; }
    isDestroyed() { return this.destroyed; }
    setBounds(value) { this.bounds = value; }
    show() { this.visible = true; }
    focus() { this.focused = true; }
    hide() { this.visible = false; this.hideCount = (this.hideCount || 0) + 1; }
    destroy() { this.destroyed = true; }
  }

  const image = {
    template: false,
    resize() { return this; },
    setTemplateImage(value) { this.template = value; }
  };
  images.push(image);

  return {
    trays,
    windows,
    images,
    actionCalls,
    dependencies: {
      BrowserWindow: FakeWindow,
      Tray: FakeTray,
      Menu: { buildFromTemplate: (items) => ({ items }) },
      nativeImage: { createFromPath: () => image },
      screen: { getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 24, width: 1440, height: 876 } }) },
      preloadPath: "/app/preload.js",
      rendererPath: "/app/menubar.html",
      iconPath: "/app/icon.png",
      actions: {
        showMainWindow: (section) => actionCalls.push(["show", section]),
        quit: () => actionCalls.push(["quit"])
      }
    }
  };
}

test("creates one template-image Tray and one hidden 320x420 panel", () => {
  const harness = createHarness();
  const controller = createMacMenuBar(harness.dependencies);
  assert.equal(harness.trays.length, 1);
  assert.equal(harness.images[0].template, true);
  assert.equal(harness.trays[0].title, "--°");
  assert.equal(harness.windows.length, 1);
  assert.equal(harness.windows[0].options.width, 320);
  assert.equal(harness.windows[0].options.height, 420);
  assert.equal(harness.windows[0].options.show, false);
  controller.destroy();
});

test("left click toggles the positioned panel and right click opens native actions", () => {
  const harness = createHarness();
  const controller = createMacMenuBar(harness.dependencies);
  harness.trays[0].emit("click");
  assert.equal(harness.windows[0].visible, true);
  assert.deepEqual(harness.windows[0].bounds, { x: 452, y: 32, width: 320, height: 420 });
  harness.trays[0].emit("click");
  assert.equal(harness.windows[0].visible, false);
  harness.trays[0].emit("right-click");
  assert.equal(harness.trays[0].popupCount, 1);
  assert.deepEqual(
    harness.trays[0].menu.items.filter((item) => item.label).map((item) => item.label),
    ["Open WinPlate", "Settings", "Refresh", "Quit"]
  );
  harness.windows[0].emit("blur");
  assert.equal(harness.windows[0].visible, false);
  assert.equal(harness.windows[0].hideCount, 2);
  controller.destroy();
});

test("updates only the bounded temperature title and destroys idempotently", () => {
  const harness = createHarness();
  const controller = createMacMenuBar(harness.dependencies);
  assert.equal(controller.setTemperature(25.6), "26°C");
  assert.equal(harness.trays[0].title, "26°C");
  assert.equal(controller.setTemperature("bad"), "--°");
  controller.destroy();
  controller.destroy();
  assert.equal(harness.trays[0].destroyCount, 1);
});
```

- [ ] **Step 2: Run the tests and confirm the missing-module failure**

```bash
node --test src/main/macMenuBar.test.js
```

Expected: FAIL with `Cannot find module './macMenuBar'`.

- [ ] **Step 3: Implement the controller API**

Create `src/main/macMenuBar.js` exporting `createMacMenuBar`. Use injected Electron dependencies and the Task 2 helpers:

```js
const { DEFAULT_PANEL_SIZE, formatTemperatureTitle, getMenuBarPanelBounds } = require("./menuBarState");

function createMacMenuBar({
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  screen,
  preloadPath,
  rendererPath,
  iconPath,
  actions
}) {
  const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  image.setTemplateImage(true);
  const tray = new Tray(image);
  const panel = new BrowserWindow({
    ...DEFAULT_PANEL_SIZE,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: true,
    vibrancy: "popover",
    visualEffectState: "active",
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  let destroyed = false;

  panel.loadFile(rendererPath);
  tray.setToolTip("WinPlate");
  tray.setTitle("--°");

  function hide() {
    if (!panel.isDestroyed()) panel.hide();
  }

  function toggle() {
    if (panel.isVisible()) {
      hide();
      return;
    }
    const trayBounds = tray.getBounds();
    const point = { x: Math.round(trayBounds.x + trayBounds.width / 2), y: Math.round(trayBounds.y + trayBounds.height) };
    const display = screen.getDisplayNearestPoint(point);
    panel.setBounds(getMenuBarPanelBounds(trayBounds, display.workArea));
    panel.show();
    panel.focus();
  }

  function popup() {
    const menu = Menu.buildFromTemplate([
      { label: "Open WinPlate", click: () => actions.showMainWindow("Dashboard") },
      { label: "Settings", click: () => actions.showMainWindow("Settings") },
      { label: "Refresh", click: () => panel.webContents.send("menubar:refresh") },
      { type: "separator" },
      { label: "Quit", click: actions.quit }
    ]);
    tray.popUpContextMenu(menu);
  }

  tray.on("click", toggle);
  tray.on("right-click", popup);
  panel.on("blur", hide);

  return {
    hide,
    toggle,
    setTemperature(value) {
      const title = formatTemperatureTitle(value);
      tray.setTitle(title);
      return title;
    },
    refresh() {
      panel.webContents.send("menubar:refresh");
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (!panel.isDestroyed()) panel.destroy();
      tray.destroy();
    }
  };
}

module.exports = { createMacMenuBar };
```

Use the production paths `src/preload/preload.js`, `src/renderer/menubar.html`, and `assets/icon-transparent.png` when the controller is instantiated in Task 6.

- [ ] **Step 4: Register, verify, and commit**

```bash
node --check src/main/macMenuBar.js
node --test src/main/macMenuBar.test.js
npm run check
git add src/main/macMenuBar.js src/main/macMenuBar.test.js
git commit -m "feat: add native macOS menu bar controller"
```

### Task 5: Accessible, in-place-updating menu panel renderer

**Files:**
- Create: `src/renderer/menubar.html`
- Create: `src/renderer/menubar.css`
- Create: `src/renderer/menubar.js`
- Modify: `src/renderer/security.test.js:1-60`

- [ ] **Step 1: Write failing renderer structure and security tests**

Append to `src/renderer/security.test.js`:

```js
test("macOS menu panel has fixed source order and a strict CSP", () => {
  const html = fs.readFileSync(path.join(__dirname, "menubar.html"), "utf8");
  assert.match(html, /Content-Security-Policy/);
  assert.ok(html.indexOf('id="codex-section"') < html.indexOf('id="deepseek-section"'));
  assert.ok(html.indexOf('id="deepseek-section"') < html.indexOf('id="weather-section"'));
  assert.ok(html.indexOf('id="weather-section"') < html.indexOf('id="panel-actions"'));
  assert.doesNotMatch(html, /onclick=|style=/);
});

test("macOS Codex panel uses neutral progress and Windows status points", () => {
  const css = fs.readFileSync(path.join(__dirname, "menubar.css"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "menubar.js"), "utf8");
  assert.match(css, /\.service-dot\.active[\s\S]*#34d399/);
  assert.match(css, /\.service-dot:not\(\.active\)[\s\S]*#71717a/);
  assert.match(css, /progress[\s\S]*accent-color:\s*#d4d4d8/);
  assert.doesNotMatch(`${css}\n${script}`, /warning|critical|danger|quota-low/i);
});

test("menu panel refresh updates named fields instead of replacing its root", () => {
  const script = fs.readFileSync(path.join(__dirname, "menubar.js"), "utf8");
  assert.match(script, /function updatePanelDom\(/);
  assert.doesNotMatch(script, /replaceChildren|innerHTML\s*=/);
  assert.match(script, /setInterval\(refresh, 30_000\)/);
});
```

- [ ] **Step 2: Run tests and confirm the missing-file failure**

```bash
node --test src/renderer/security.test.js
```

Expected: FAIL with `ENOENT` for `menubar.html`.

- [ ] **Step 3: Create the semantic panel document**

Create `src/renderer/menubar.html` with the strict CSP, shared model, and renderer script:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src http://127.0.0.1:8765">
    <title>WinPlate 状态</title>
    <link rel="stylesheet" href="./menubar.css">
  </head>
  <body>
    <main class="panel" aria-label="WinPlate 状态面板">
      <section id="codex-section" class="panel-section" aria-labelledby="codex-title">
        <header><div><span id="codex-dot" class="service-dot"></span><h1 id="codex-title">Codex</h1></div><small id="codex-updated">未更新</small></header>
        <div class="quota-row"><label for="codex-five-progress">5 小时</label><progress id="codex-five-progress" max="100" value="0"></progress><strong id="codex-five-percent">--%</strong><time id="codex-five-reset">--</time></div>
        <div class="quota-row"><label for="codex-seven-progress">7 天</label><progress id="codex-seven-progress" max="100" value="0"></progress><strong id="codex-seven-percent">--%</strong><time id="codex-seven-reset">--</time></div>
        <p id="codex-status">Codex CLI unavailable</p>
      </section>
      <section id="deepseek-section" class="panel-section" aria-labelledby="deepseek-title">
        <header><div><span id="deepseek-dot" class="service-dot"></span><h2 id="deepseek-title">DeepSeek</h2></div><small id="deepseek-updated">未更新</small></header>
        <p class="balance"><span>余额</span><strong id="deepseek-balance">--</strong><span>CNY</span></p>
        <p id="deepseek-status">DeepSeek API unconfigured</p>
        <button id="deepseek-settings" type="button">配置 DeepSeek</button>
      </section>
      <section id="weather-section" class="panel-section weather" aria-labelledby="weather-title">
        <img id="weather-icon" alt="" hidden>
        <div><h2 id="weather-title">天气</h2><strong id="weather-temperature">--°</strong><p id="weather-condition">天气不可用</p><small id="weather-location"></small></div>
      </section>
      <footer id="panel-actions">
        <button id="open-winplate" type="button">打开 WinPlate</button>
        <button id="refresh-panel" type="button">刷新</button>
        <button id="open-settings" type="button">设置</button>
      </footer>
    </main>
    <script src="../shared/menuBarModel.js"></script>
    <script src="./menubar.js"></script>
  </body>
</html>
```

- [ ] **Step 4: Add compact native-material styling**

Create `src/renderer/menubar.css` with these required rules and matching light appearance overrides:

```css
:root { color-scheme: light dark; font: 13px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: #f4f4f5; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
button, progress { font: inherit; }
.panel { height: 100%; overflow-y: auto; padding: 10px 14px 12px; background: rgba(28, 28, 30, .78); border: 1px solid rgba(255, 255, 255, .14); border-radius: 14px; backdrop-filter: blur(28px); }
.panel-section { padding: 12px 2px; border-bottom: 1px solid rgba(255, 255, 255, .12); }
.panel-section header, .panel-section header > div, #panel-actions, .quota-row, .balance, .weather { display: flex; align-items: center; }
.panel-section header { justify-content: space-between; margin-bottom: 10px; }
.panel-section header > div { gap: 8px; }
h1, h2, p { margin: 0; }
h1, h2 { font-size: 13px; }
small, .panel-section > p { color: #a1a1aa; font-size: 11px; }
.service-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: #71717a; box-shadow: none; }
.service-dot.active { background: #34d399; box-shadow: 0 0 10px rgba(52, 211, 153, .55); }
.service-dot:not(.active) { background: #71717a; box-shadow: none; }
.quota-row { display: grid; grid-template-columns: 46px minmax(72px, 1fr) 38px 58px; gap: 8px; margin: 8px 0; }
.quota-row label, .quota-row strong, .quota-row time { font-size: 11px; font-variant-numeric: tabular-nums; }
.quota-row time { color: #a1a1aa; text-align: right; }
progress { width: 100%; height: 6px; accent-color: #d4d4d8; }
.balance { gap: 6px; margin-bottom: 5px; }
.balance strong { font-size: 22px; font-variant-numeric: tabular-nums; }
.weather { gap: 12px; }
.weather img { width: 34px; height: 34px; object-fit: contain; filter: brightness(0) invert(1); }
#weather-temperature { font-size: 22px; }
#panel-actions { gap: 7px; padding-top: 12px; }
button { min-height: 28px; padding: 5px 9px; color: inherit; border: 1px solid rgba(255,255,255,.14); border-radius: 7px; background: rgba(255,255,255,.08); cursor: pointer; }
button:focus-visible { outline: 2px solid #60a5fa; outline-offset: 1px; }
@media (prefers-color-scheme: light) {
  :root { color: #18181b; }
  .panel { background: rgba(248,248,250,.82); border-color: rgba(24,24,27,.12); }
  .panel-section { border-color: rgba(24,24,27,.10); }
  .weather img { filter: brightness(0); }
  button { border-color: rgba(24,24,27,.12); background: rgba(24,24,27,.05); }
}
```

- [ ] **Step 5: Implement refresh and in-place DOM updates**

Create `src/renderer/menubar.js`. Use `Promise.allSettled`, convert each result into the reducer's `{ ok, value/error }` form, and update named nodes only:

```js
const { EMPTY_PANEL_STATE, reducePanelState } = window.WinPlateMenuBarModel;
let panelState = EMPTY_PANEL_STATE;
let refreshing = false;

function resultOf(entry) {
  return entry.status === "fulfilled"
    ? { ok: true, value: entry.value }
    : { ok: false, error: entry.reason?.message || "Unavailable" };
}

function formatUpdatedAt(value) {
  if (!value) return "未更新";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function setService(id, active, activeText, inactiveText) {
  document.querySelector(`#${id}-dot`).classList.toggle("active", active);
  document.querySelector(`#${id}-status`).textContent = active ? activeText : inactiveText;
}

function setQuota(prefix, value) {
  const percent = Number.isFinite(value.remainingPct) ? value.remainingPct : null;
  document.querySelector(`#codex-${prefix}-progress`).value = percent ?? 0;
  document.querySelector(`#codex-${prefix}-progress`).removeAttribute("aria-valuetext");
  if (percent === null) document.querySelector(`#codex-${prefix}-progress`).setAttribute("aria-valuetext", "不可用");
  document.querySelector(`#codex-${prefix}-percent`).textContent = percent === null ? "--%" : `${Math.round(percent)}%`;
  document.querySelector(`#codex-${prefix}-reset`).textContent = value.resetText || "--";
}

function updatePanelDom() {
  setService("codex", panelState.codex.active, "Codex CLI active", "Codex CLI unavailable");
  setQuota("five", panelState.codex.fiveHour);
  setQuota("seven", panelState.codex.sevenDay);
  document.querySelector("#codex-updated").textContent = formatUpdatedAt(panelState.codex.updatedAt);

  setService("deepseek", panelState.deepseek.active, "DeepSeek API active", `DeepSeek API ${panelState.deepseek.status.toLowerCase()}`);
  document.querySelector("#deepseek-balance").textContent = panelState.deepseek.balance ?? "--";
  document.querySelector("#deepseek-updated").textContent = formatUpdatedAt(panelState.deepseek.updatedAt);
  document.querySelector("#deepseek-settings").hidden = panelState.deepseek.status !== "Unconfigured";

  const weather = panelState.weather;
  document.querySelector("#weather-temperature").textContent = weather.available ? `${Math.round(weather.temperature)}°` : "--°";
  document.querySelector("#weather-condition").textContent = weather.available ? weather.condition : "天气不可用";
  document.querySelector("#weather-location").textContent = weather.location;
  const weatherIcon = document.querySelector("#weather-icon");
  weatherIcon.hidden = !weather.available || !weather.icon;
  if (weather.available && weather.icon) weatherIcon.src = `../../node_modules/qweather-icons/icons/${weather.icon}.svg`;
  window.winplate.updateMenuBarTemperature(weather.available ? weather.temperature : null);
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  document.querySelector("#refresh-panel").disabled = true;
  try {
    const [status, codex, deepseek] = await Promise.allSettled([
      window.winplate.getStatus(),
      window.winplate.getCodexUsage({ force: true }),
      window.winplate.getDeepSeekUsage({ force: true })
    ]);
    panelState = reducePanelState(panelState, {
      status: resultOf(status),
      codex: resultOf(codex),
      deepseek: resultOf(deepseek)
    });
    updatePanelDom();
  } finally {
    document.querySelector("#refresh-panel").disabled = false;
    refreshing = false;
  }
}

document.querySelector("#open-winplate").addEventListener("click", () => window.winplate.showMainWindow("Dashboard"));
document.querySelector("#open-settings").addEventListener("click", () => window.winplate.showMainWindow("Settings"));
document.querySelector("#deepseek-settings").addEventListener("click", () => window.winplate.showMainWindow("Settings"));
document.querySelector("#refresh-panel").addEventListener("click", refresh);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.winplate.hideMenuBarPanel();
});
window.winplate.onMenuBarRefresh(refresh);
refresh();
setInterval(refresh, 30_000);
```

- [ ] **Step 6: Register, verify, and commit**

```bash
node --check src/renderer/menubar.js
node --test src/renderer/security.test.js
npm run check
git add src/renderer/menubar.html src/renderer/menubar.css src/renderer/menubar.js src/renderer/security.test.js
git commit -m "feat: render the macOS menu status panel"
```

Expected: fixed section order, neutral quota presentation, status-point, CSP, and in-place-update tests pass.

### Task 6: Secure IPC and platform startup with no macOS capsule

**Files:**
- Create: `src/main/startupPolicy.test.js`
- Create: `src/main/startupPolicy.js`
- Modify: `src/preload/preload.js:1-40`
- Modify: `src/main/main.js:1-270`
- Modify: `src/renderer/security.test.js:1-90`
- Modify: `package.json:10-14`

- [ ] **Step 1: Write failing startup and bridge tests**

Create `src/main/startupPolicy.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { startupPolicy } = require("./startupPolicy");

test("Windows preserves its Tray and desktop floating capsule", () => {
  assert.deepEqual(startupPolicy("win32"), {
    createWindowsTray: true,
    createMacMenuBar: false,
    createFloatingWindow: true
  });
});

test("macOS creates only the native menu bar entry point", () => {
  assert.deepEqual(startupPolicy("darwin"), {
    createWindowsTray: false,
    createMacMenuBar: true,
    createFloatingWindow: false
  });
});
```

Append to `src/renderer/security.test.js`:

```js
test("preload exposes only bounded menu panel methods", () => {
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload", "preload.js"), "utf8");
  assert.match(preload, /updateMenuBarTemperature/);
  assert.match(preload, /hideMenuBarPanel/);
  assert.match(preload, /onMenuBarRefresh/);
  assert.doesNotMatch(preload, /require:\s*require|ipcRenderer:\s*ipcRenderer/);
});
```

- [ ] **Step 2: Run tests and confirm the startup module is absent**

```bash
node --test src/main/startupPolicy.test.js src/renderer/security.test.js
```

Expected: FAIL with `Cannot find module './startupPolicy'`.

- [ ] **Step 3: Implement the exact startup policy**

Create `src/main/startupPolicy.js`:

```js
function startupPolicy(platform = process.platform) {
  if (platform === "darwin") {
    return { createWindowsTray: false, createMacMenuBar: true, createFloatingWindow: false };
  }
  return { createWindowsTray: true, createMacMenuBar: false, createFloatingWindow: true };
}

module.exports = { startupPolicy };
```

- [ ] **Step 4: Add the narrow preload methods**

Add these properties inside the existing `contextBridge.exposeInMainWorld("winplate", ...)` object:

```js
updateMenuBarTemperature: (temperature) => ipcRenderer.send("menubar:update-temperature", temperature),
hideMenuBarPanel: () => ipcRenderer.send("menubar:hide"),
onMenuBarRefresh: (callback) => ipcRenderer.on("menubar:refresh", () => callback()),
```

Do not expose Tray, BrowserWindow, nativeImage, IPC objects, paths, or arbitrary channel names.

- [ ] **Step 5: Integrate macOS startup and validated IPC**

At the top of `src/main/main.js`, import the native Electron objects and focused modules:

```js
const path = require("path");
const { app, BrowserWindow, ipcMain, Menu, nativeImage, nativeTheme, screen, session, shell, Tray } = require("electron");
const { createMacMenuBar } = require("./macMenuBar");
const { startupPolicy } = require("./startupPolicy");
```

Add one module-level controller:

```js
let macMenuBar;
```

Replace unconditional floating/Tray creation inside `app.whenReady()` with:

```js
createMainWindow(initialTheme);
const policy = startupPolicy();
if (policy.createFloatingWindow) createFloatingWindow();

const quit = () => {
  setQuitting(true);
  app.quit();
};

if (policy.createWindowsTray) {
  tray = createAppTray({ showMainWindow, showFloatingWindow, hideFloatingWindow, quit });
}

if (policy.createMacMenuBar) {
  macMenuBar = createMacMenuBar({
    BrowserWindow,
    Menu,
    Tray,
    nativeImage,
    screen,
    preloadPath: path.join(__dirname, "..", "preload", "preload.js"),
    rendererPath: path.join(__dirname, "..", "renderer", "menubar.html"),
    iconPath: path.join(__dirname, "..", "..", "assets", "icon-transparent.png"),
    actions: { showMainWindow, quit }
  });
}
```

Register the menu IPC exactly once with the other handlers:

```js
ipcMain.on("menubar:update-temperature", (_event, temperature) => {
  macMenuBar?.setTemperature(temperature);
});
ipcMain.on("menubar:hide", () => macMenuBar?.hide());
```

Destroy the controller during explicit quit:

```js
app.on("before-quit", () => {
  setQuitting(true);
  macMenuBar?.destroy();
  macMenuBar = null;
  stopPythonService();
});
```

Do not call `createFloatingWindow`, `showFloatingWindow`, `setFloatingPinned`, or Tooltip creation from any macOS startup path.

- [ ] **Step 6: Register and run focused lifecycle checks**

Replace the `check` script with the complete final command:

```json
"check": "node --check src/main/main.js && node --check src/main/appearanceSettings.js && node --check src/main/codexUsage.js && node --check src/main/deepseekUsage.js && node --check src/main/pythonService.js && node --check src/main/windows.js && node --check src/main/tray.js && node --check src/main/menuBarState.js && node --check src/main/macMenuBar.js && node --check src/main/startupPolicy.js && node --check src/preload/preload.js && node --check src/renderer/app.js && node --check src/renderer/menubar.js && node --check src/shared/mockStatus.js && node --check src/shared/menuBarModel.js && node --test src/main/appearanceSettings.test.js src/main/codexUsage.test.js src/main/deepseekUsage.test.js src/main/menuBarState.test.js src/main/macMenuBar.test.js src/main/startupPolicy.test.js src/shared/menuBarModel.test.js src/renderer/security.test.js"
```

Run:

```bash
node --test src/main/startupPolicy.test.js src/main/macMenuBar.test.js src/renderer/security.test.js
npm run check
```

Expected: macOS policy asserts `createFloatingWindow: false`; Windows behavior remains true and all checks pass.

- [ ] **Step 7: Commit the integration**

```bash
git add src/main/startupPolicy.js src/main/startupPolicy.test.js src/main/main.js src/preload/preload.js src/renderer/security.test.js package.json
git commit -m "feat: start WinPlate from the macOS menu bar"
```

### Task 7: Full verification and macOS smoke test

**Files:**
- Modify: `design-qa.md`

- [ ] **Step 1: Run all automated checks**

```bash
npm run check
npm run backend:test
git diff --check
```

Expected: Node syntax/tests, backend tests, and whitespace validation all pass.

- [ ] **Step 2: Start the application on macOS**

```bash
npm run dev
```

Expected: one WinPlate Template Image plus a temperature title appears in the macOS menu bar; no desktop floating capsule or Tooltip window appears.

- [ ] **Step 3: Exercise native menu behavior**

Record these observations in `design-qa.md`:

```markdown
## macOS menu bar smoke test — 2026-06-29

- [ ] Left click opens and closes the panel beneath the status item.
- [ ] Right click offers Open WinPlate, Settings, Refresh, and Quit.
- [ ] Blur and Escape dismiss the panel.
- [ ] The panel remains on-screen at left/right display edges and on a secondary display.
- [ ] Light and dark appearance keep the Template Image, text, dividers, and weather icon legible.
- [ ] No macOS desktop floating capsule is created.
```

- [ ] **Step 4: Exercise live, failure, and refresh states**

Add the observed results beneath the same heading:

```markdown
- [ ] Codex shows 5-hour and 7-day values with neutral progress bars.
- [ ] Codex and DeepSeek use the Windows green active / gray unavailable status points.
- [ ] Quota changes never add yellow or red presentation.
- [ ] DeepSeek unconfigured state opens Settings and does not fabricate a balance.
- [ ] Weather failure keeps the status item visible as `--°`.
- [ ] Refresh updates values without closing or rebuilding the panel.
- [ ] Partial and all-source failures keep Open WinPlate, Settings, Refresh, and Quit usable.
```

- [ ] **Step 5: Re-run Windows regression checks**

Run:

```bash
node --test src/main/startupPolicy.test.js src/renderer/security.test.js
```

Expected: Windows still starts its existing floating capsule and Tray; no Windows dimensions, renderer markup, or Tooltip behavior changed.

- [ ] **Step 6: Commit the verified QA record**

```bash
git add design-qa.md
git commit -m "test: verify macOS menu bar experience"
```

## Completion check

The feature is complete only when one native macOS menu bar item shows the WinPlate icon and temperature, the anchored panel displays Codex → DeepSeek → weather → actions using real data and in-place refresh, source failures degrade independently, Codex uses no quota warning colors, no macOS desktop floating capsule is created, Windows behavior remains unchanged, and all automated and smoke checks pass.
