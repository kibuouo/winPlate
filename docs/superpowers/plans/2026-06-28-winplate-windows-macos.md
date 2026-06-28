# WinPlate Windows + macOS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Turn the repository into a two-platform Electron application that preserves the Windows floating-capsule experience and adds a native macOS menu bar center, main window, preferences, and optional capsule.

**Architecture:** Keep FastAPI and status sources shared. Select native window and Tray adapters once at startup, retain the existing renderer for the main window and desktop capsule, and use a focused renderer for the macOS popover. Preference, positioning, and digest logic stay pure and unit-testable.

**Tech Stack:** Electron 40, CommonJS, browser JavaScript/CSS, Node.js test runner, FastAPI/Python.

---

## File responsibilities

- src/main/appSettings.js: validated atomic persistence for native-app preferences.
- src/shared/statusDigest.js: deterministic metrics, severity items, and menu title data.
- src/main/platform/index.js: one-time Windows/macOS selection.
- src/main/platform/windows.win32.js and windows.darwin.js: window policy and positioning.
- src/main/platform/tray.win32.js and tray.darwin.js: native Tray construction and events.
- src/main/windows.js, tray.js, main.js: shared lifecycle and IPC orchestration.
- src/renderer/menubar.html, menubar.js, menubar.css: isolated macOS popover.
- src/renderer/index.html, app.js, styles.css: existing main/capsule renderer with platform-scoped presentation.
- src/preload/preload.js: safe platform and settings bridge.

### Task 1: Repository cleanup and cross-platform development command

**Files:**
- Delete: design/
- Modify: package.json
- Modify: README.md

- [ ] **Step 1: Verify the existing baseline**

Run:

~~~bash
npm run check
~~~

Expected: all current syntax checks and Node tests pass.

- [ ] **Step 2: Remove the user-rejected untracked designs**

Run:

~~~bash
rm -rf design
test ! -e design
~~~

Expected: both commands succeed and git status no longer shows design/.

- [ ] **Step 3: Make package metadata platform-neutral**

Set package.json description to A multi-platform status center for Windows and macOS built with Electron. Replace the dev script with:

~~~json
"dev": "cross-env FORCE_COLOR=1 electron ."
~~~

Keep all other dependencies and scripts.

- [ ] **Step 4: Document both development environments**

Replace the README opening commands with:

~~~markdown
## Development

macOS:
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt

Windows PowerShell:
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend/requirements.txt

Both:
npm install
npm run dev
~~~

State that Windows starts with the capsule, while macOS starts from the menu bar.

- [ ] **Step 5: Verify and commit**

~~~bash
npm pkg get description scripts.dev
git status --short
git add package.json README.md
git commit -m "chore: prepare WinPlate for two desktop platforms"
~~~

Expected: metadata is correct, design/ is absent, and the commit succeeds.

### Task 2: Validated native-app preferences

**Files:**
- Create: src/main/appSettings.js
- Create: src/main/appSettings.test.js
- Modify: package.json

- [ ] **Step 1: Write failing tests**

Test these exact cases with node:test:

~~~js
assert.deepEqual(normalizeAppSettings({ menuBarEnabled: "yes" }), DEFAULT_APP_SETTINGS);

const expected = {
  menuBarEnabled: false,
  menuBarDisplay: "compact",
  desktopCapsuleEnabled: true,
  desktopCapsulePinned: true,
  launchAtLogin: true
};
await writeAppSettings(directory, expected);
assert.deepEqual(await readAppSettings(directory), expected);
await fs.writeFile(path.join(directory, "app-settings.json"), "{broken", "utf8");
assert.deepEqual(await readAppSettings(directory), DEFAULT_APP_SETTINGS);

const calls = [];
applyLoginItemSetting({ setLoginItemSettings: (value) => calls.push(value) }, true);
assert.deepEqual(calls, [{ openAtLogin: true }]);
~~~

- [ ] **Step 2: Confirm the missing-module failure**

~~~bash
node --test src/main/appSettings.test.js
~~~

Expected: FAIL with Cannot find module './appSettings'.

- [ ] **Step 3: Implement normalization and atomic storage**

Use this public API:

~~~js
const DEFAULT_APP_SETTINGS = Object.freeze({
  menuBarEnabled: true,
  menuBarDisplay: "icon",
  desktopCapsuleEnabled: false,
  desktopCapsulePinned: false,
  launchAtLogin: false
});

function normalizeAppSettings(value = {}) {
  return {
    menuBarEnabled: typeof value.menuBarEnabled === "boolean" ? value.menuBarEnabled : true,
    menuBarDisplay: ["icon", "compact"].includes(value.menuBarDisplay) ? value.menuBarDisplay : "icon",
    desktopCapsuleEnabled: typeof value.desktopCapsuleEnabled === "boolean" ? value.desktopCapsuleEnabled : false,
    desktopCapsulePinned: typeof value.desktopCapsulePinned === "boolean" ? value.desktopCapsulePinned : false,
    launchAtLogin: typeof value.launchAtLogin === "boolean" ? value.launchAtLogin : false
  };
}

function applyLoginItemSetting(app, enabled) {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
}
~~~

readAppSettings reads app-settings.json and returns defaults for ENOENT or invalid JSON. writeAppSettings writes normalized JSON to app-settings.json.tmp, then renames it atomically.

- [ ] **Step 4: Run focused tests**

~~~bash
node --test src/main/appSettings.test.js
~~~

Expected: preference tests pass.

- [ ] **Step 5: Add syntax/test entries and commit**

Add appSettings.js to node --check and appSettings.test.js to node --test in package.json.

~~~bash
npm run check
git add src/main/appSettings.js src/main/appSettings.test.js package.json
git commit -m "feat: persist multi-platform application preferences"
~~~

### Task 3: Deterministic status digest

**Files:**
- Create: src/shared/statusDigest.js
- Create: src/shared/statusDigest.test.js
- Modify: package.json

- [ ] **Step 1: Write failing digest tests**

Cover these values:

~~~js
const normal = buildStatusDigest({
  codex: { remainingPct: 69, status: "Normal" },
  heart: { heartRate: 82 },
  weather: { source: "qweather", temperature: 23, condition: "Partly cloudy" },
  github: { availability: "live", username: "@kibuouo" },
  deepseek: { configured: true, status: "Normal" }
});
assert.equal(normal.attentionCount, 0);
assert.equal(formatMenuBarTitle(normal, "compact"), "69% · 23°");

const risk = buildStatusDigest({
  codex: { remainingPct: 8, status: "Normal" },
  weather: { source: "unconfigured" },
  github: { availability: "rate-limit" },
  deepseek: { configured: true, status: "Unavailable" }
});
assert.equal(risk.attentionCount, 4);
assert.equal(risk.items.length, 3);
assert.equal(risk.items[0].severity, "red");
assert.equal(formatMenuBarTitle(risk, "compact"), "⚠ 4");

const heart = buildStatusDigest({ heart: { heartRate: 180 } });
assert.equal(heart.items.some((entry) => entry.source === "heart" && entry.severity !== "blue"), false);
~~~

Also assert normalizeMenuBarSummary clamps attentionCount to 0-99 and strips punctuation/markup from two eight-character metric strings.

- [ ] **Step 2: Confirm the missing-module failure**

~~~bash
node --test src/shared/statusDigest.test.js
~~~

Expected: FAIL with Cannot find module './statusDigest'.

- [ ] **Step 3: Implement the pure shared API**

Export buildStatusDigest, formatMenuBarTitle, and normalizeMenuBarSummary for CommonJS and window.WinPlateStatusDigest.

Rules:

~~~js
const severityOrder = { red: 0, yellow: 1, blue: 2 };
// Red: explicit source unavailable/error, or Codex <= 10.
// Yellow: Codex 11-20, weather unconfigured, GitHub auth/rate-limit,
//         or configured DeepSeek not Normal.
// Blue: ordinary status items.
// Sort by severity then source, expose only the first three,
// but calculate attentionCount from every red/yellow item.
// Never classify heart-rate values as medical risk.
~~~

Return metrics with keys codex, heart, weather, github. formatMenuBarTitle returns ⚠ n for attention, codex · weather for compact, and an empty string for icon mode.

- [ ] **Step 4: Run tests and commit**

~~~bash
node --test src/shared/statusDigest.test.js
npm run check
git add src/shared/statusDigest.js src/shared/statusDigest.test.js package.json
git commit -m "feat: derive bounded status digests"
~~~

### Task 4: Tested window policies

**Files:**
- Create: src/main/platform/index.js
- Create: src/main/platform/windows.win32.js
- Create: src/main/platform/windows.darwin.js
- Create: src/main/platform/windows.test.js
- Modify: package.json

- [ ] **Step 1: Write failing policy tests**

Assert:

~~~js
assert.equal(win32.startWithFloating, true);
assert.equal(win32.mainWindowOptions(common).frame, false);
assert.equal(win32.floatingWindowOptions(common).width, 460);
assert.equal(win32.floatingWindowOptions(common).height, 104);

assert.equal(darwin.startWithFloating, false);
assert.equal(darwin.mainWindowOptions(common).titleBarStyle, "hiddenInset");
assert.equal(darwin.mainWindowOptions(common).frame, true);
assert.equal(darwin.menuBarPanelOptions(common).width, 380);
assert.equal(darwin.menuBarPanelOptions(common).height, 540);
assert.equal(darwin.floatingWindowOptions(common).width, 360);
assert.equal(darwin.floatingWindowOptions(common).height, 84);

assert.equal(loadPlatform("win32").name, "win32");
assert.equal(loadPlatform("darwin").name, "darwin");
assert.throws(() => loadPlatform("linux"), /Unsupported platform/);
~~~

Test positionMenuBarPanel against left/right screen edges and a display with negative x coordinates.

- [ ] **Step 2: Confirm missing modules**

~~~bash
node --test src/main/platform/windows.test.js
~~~

Expected: FAIL because platform modules are absent.

- [ ] **Step 3: Implement Windows policy with unchanged values**

windows.win32.js exports supportsMenuBarPanel: false and startWithFloating: true, then returns current 1080x720/minimum 860x560 frameless main options, current 460x104 always-on-top floating options, current top-right positioning, and the current pin/click-through behavior.

- [ ] **Step 4: Implement macOS native policy**

Export supportsMenuBarPanel: true and startWithFloating: false. Use:

~~~js
mainWindowOptions: {
  width: 1040, height: 720, minWidth: 880, minHeight: 580,
  show: false, title: "WinPlate", frame: true,
  titleBarStyle: "hiddenInset",
  trafficLightPosition: { x: 16, y: 16 },
  vibrancy: "window", visualEffectState: "followWindow",
  backgroundColor: "#00000000"
}

menuBarPanelOptions: {
  width: 380, height: 540, frame: false, transparent: true,
  resizable: false, movable: false, skipTaskbar: true, show: false,
  hasShadow: true, vibrancy: "popover", visualEffectState: "active"
}

floatingWindowOptions: {
  width: 360, height: 84, frame: false, transparent: true,
  resizable: false, movable: true, alwaysOnTop: false,
  skipTaskbar: true, show: false, hasShadow: true, type: "panel"
}
~~~

positionMenuBarPanel centers below Tray bounds and clamps x/y inside workArea with an 8px inset. macOS pinning toggles always-on-top, visible-on-all-workspaces, and click-through together.

- [ ] **Step 5: Implement one-time selection**

~~~js
function loadPlatform(platform = process.platform) {
  if (platform === "win32") return { name: "win32", windows: require("./windows.win32") };
  if (platform === "darwin") return { name: "darwin", windows: require("./windows.darwin") };
  throw new Error("Unsupported platform: " + platform);
}
~~~

Task 5 extends each returned object with its Tray adapter after those files exist.

- [ ] **Step 6: Run, register, and commit**

~~~bash
node --test src/main/platform/windows.test.js
npm run check
git add src/main/platform package.json
git commit -m "feat: define Windows and macOS window policies"
~~~

### Task 5: Platform-specific Tray behavior

**Files:**
- Create: src/main/platform/tray.win32.js
- Create: src/main/platform/tray.darwin.js
- Create: src/main/platform/tray.test.js
- Modify: src/main/tray.js
- Modify: package.json

- [ ] **Step 1: Write failing fake-driven Tray tests**

Use injected fake Menu, Tray, icon, actions, and getPreferences objects. Assert:

~~~js
// Windows
assert.equal(tray.contextMenu.items[0].label, "Show WinPlate");
tray.emit("double-click");
assert.deepEqual(actionCalls, ["showMainWindow"]);

// macOS
assert.equal(tray.contextMenu, undefined);
tray.emit("click", {}, { x: 20, y: 0, width: 16, height: 24 });
assert.equal(actionCalls[0][0], "toggleMenuBarPanel");
tray.emit("right-click");
assert.equal(tray.popupMenus.length, 1);

tray.updateSummary({ attentionCount: 0, codex: "69%", weather: "23°" });
assert.equal(tray.title, "69% · 23°");
tray.updateSummary({ attentionCount: 2, codex: "69%", weather: "23°" });
assert.equal(tray.title, "⚠ 2");
~~~

- [ ] **Step 2: Confirm missing adapters**

~~~bash
node --test src/main/platform/tray.test.js
~~~

Expected: FAIL because Tray adapters are absent.

- [ ] **Step 3: Move Windows behavior without product changes**

tray.win32.js creates the current context menu and double-click handler. Attach a no-op updateSummary method.

- [ ] **Step 4: Implement macOS behavior**

tray.darwin.js must not call setContextMenu. Left click calls toggleMenuBarPanel(bounds). Right click calls popUpContextMenu with Open WinPlate, Settings, checked Show Desktop Capsule, and Quit. updateSummary applies warning, compact, or empty native titles.

- [ ] **Step 5: Build a two-representation Template Image**

Extend platform/index.js so the win32 branch returns tray: require("./tray.win32") and the darwin branch returns tray: require("./tray.darwin"). In tray.js, load assets/icon.png and fall back to assets/icon-transparent.png when nativeImage.isEmpty() is true. Log once and give the macOS Tray an initial W title if both are empty, so the app remains reachable. For macOS create an empty NativeImage, add 16px at scaleFactor 1 and 32px at scaleFactor 2, call setTemplateImage(true), then inject it into the selected adapter. Windows keeps the current resized 16px image.

- [ ] **Step 6: Run and commit**

~~~bash
node --test src/main/platform/tray.test.js
npm run check
git add src/main/platform src/main/tray.js package.json
git commit -m "feat: add native Tray behavior per platform"
~~~

### Task 6: Shared lifecycle, settings application, and IPC

**Files:**
- Modify: src/main/windows.js
- Modify: src/main/main.js
- Modify: src/preload/preload.js
- Modify: src/renderer/security.test.js

- [ ] **Step 1: Add a failing preload contract test**

~~~js
assert.match(preload, /platform:\s*process\.platform/);
assert.match(preload, /app:get-settings/);
assert.match(preload, /app:save-settings/);
assert.match(preload, /app:toggle-desktop-capsule/);
assert.match(preload, /menu-bar:update-summary/);
assert.doesNotMatch(preload, /@electron\/remote|require:\s*require/);
~~~

- [ ] **Step 2: Verify failure**

~~~bash
node --test src/renderer/security.test.js
~~~

Expected: FAIL because new bridge fields are absent.

- [ ] **Step 3: Route windows.js through the selected policy**

Use policy option factories for main/floating creation and platform name in renderer query parameters. Preserve Windows Tooltip code; return without creating Tooltips on macOS.

Add:

~~~js
function createMenuBarPanelWindow() {
  if (!windowPolicy.supportsMenuBarPanel) return null;
  if (menuBarPanelWindow && !menuBarPanelWindow.isDestroyed()) return menuBarPanelWindow;
  menuBarPanelWindow = new BrowserWindow(windowPolicy.menuBarPanelOptions({
    webPreferences: secureWebPreferences()
  }));
  menuBarPanelWindow.loadFile(path.join(__dirname, "..", "renderer", "menubar.html"));
  menuBarPanelWindow.on("blur", () => menuBarPanelWindow && menuBarPanelWindow.hide());
  menuBarPanelWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape") {
      event.preventDefault();
      menuBarPanelWindow.hide();
    }
  });
  menuBarPanelWindow.on("closed", () => { menuBarPanelWindow = null; });
  return menuBarPanelWindow;
}
~~~

toggleMenuBarPanel obtains the nearest display, calls positionMenuBarPanel, then show/focuses or hides. Export create/toggle/hide menu panel and isFloatingWindowVisible.

- [ ] **Step 4: Expose narrow preload methods**

~~~js
platform: process.platform,
getAppSettings: () => ipcRenderer.invoke("app:get-settings"),
saveAppSettings: (settings) => ipcRenderer.invoke("app:save-settings", settings),
toggleDesktopCapsule: () => ipcRenderer.invoke("app:toggle-desktop-capsule"),
updateMenuBarSummary: (summary) => ipcRenderer.send("menu-bar:update-summary", summary),
~~~

- [ ] **Step 5: Apply preferences in main.js**

Read preferences before window creation. Always create the hidden main window. Windows creates floating and Tray exactly as before. macOS creates the hidden popover, conditionally creates Tray, and only shows the capsule when enabled.

Implement:

~~~js
async function saveAndApplyAppSettings(value) {
  const saved = await writeAppSettings(app.getPath("userData"), value);
  appSettings = normalizeAppSettings(saved);
  if (platform.name === "darwin") {
    if (appSettings.menuBarEnabled) createTrayIfEnabled();
    else destroyTrayAndHidePanel();
    if (appSettings.desktopCapsuleEnabled) showFloatingWindow();
    else hideFloatingWindow();
    setFloatingPinned(appSettings.desktopCapsulePinned);
    applyLoginItemSetting(app, appSettings.launchAtLogin);
    if (tray) tray.updateSummary(lastMenuBarSummary);
  }
  return appSettings;
}
~~~

Define createTrayIfEnabled so it returns the existing Tray when present, refuses creation only when macOS menuBarEnabled is false, and injects showMainWindow, show/hide floating, toggleMenuBarPanel, isFloatingWindowVisible, toggleDesktopCapsule, and explicit Quit actions. Define:

~~~js
function destroyTrayAndHidePanel() {
  hideMenuBarPanel();
  if (tray) tray.destroy();
  tray = null;
}
~~~

toggleDesktopCapsule saves the inverse of desktopCapsuleEnabled through saveAndApplyAppSettings. Register app:get-settings, app:save-settings, app:toggle-desktop-capsule, and menu-bar:update-summary once. Normalize every incoming summary before passing it to Tray.

- [ ] **Step 6: Run and commit**

~~~bash
node --test src/renderer/security.test.js
npm run check
git add src/main/main.js src/main/windows.js src/preload/preload.js src/renderer/security.test.js
git commit -m "feat: integrate platform window lifecycle"
~~~

### Task 7: macOS popover renderer

**Files:**
- Create: src/renderer/menubar.html
- Create: src/renderer/menubar.js
- Create: src/renderer/menubar.css
- Create: src/renderer/menubar.test.js
- Modify: package.json

- [ ] **Step 1: Write failing static-contract tests**

Assert menubar.html contains CSP, statusDigest.js, metric-codex, metric-heart, metric-weather, metric-github, digest-list, open-main, open-settings, and toggle-capsule. Assert menubar.js calls showMainWindow("Settings"), toggleDesktopCapsule, and updateMenuBarSummary. Reject inline onclick and style attributes.

- [ ] **Step 2: Verify ENOENT failure**

~~~bash
node --test src/renderer/menubar.test.js
~~~

Expected: FAIL because menubar.html does not exist.

- [ ] **Step 3: Create secure semantic HTML**

Load scripts in this order:

~~~html
<script src="../shared/mockStatus.js"></script>
<script src="../shared/statusDigest.js"></script>
<script src="./menubar.js"></script>
~~~

Use a status header, 2x2 metric grid, digest list, and three-action footer. All status values are set through textContent.

- [ ] **Step 4: Implement resilient refresh**

Fetch base status, Codex, and DeepSeek with per-source fallbacks; merge with mock/current data; call buildStatusDigest; render four metrics and at most three buttons; send only attentionCount, codex, and weather through updateMenuBarSummary. Start immediately and repeat every 30 seconds.

Each digest button opens its section. Footer buttons open Dashboard, open Settings, and toggle the capsule while updating the button label.

- [ ] **Step 5: Style the approved 380x540 hierarchy**

Use 18px outer radius, system typography, 2x2 metrics, three digest rows, fixed footer, visible focus, 44px action targets, reduced-motion handling, and light/dark media colors. Use red #fb7185, yellow #fbbf24, blue #60a5fa only inside content.

- [ ] **Step 6: Run and commit**

~~~bash
node --test src/renderer/menubar.test.js
npm run check
git add src/renderer/menubar.html src/renderer/menubar.js src/renderer/menubar.css src/renderer/menubar.test.js package.json
git commit -m "feat: add macOS menu bar status popover"
~~~

### Task 8: Native macOS main window and compact capsule renderer

**Files:**
- Modify: src/renderer/index.html
- Modify: src/renderer/app.js
- Modify: src/renderer/styles.css
- Modify: src/renderer/security.test.js

- [ ] **Step 1: Add failing renderer branch tests**

~~~js
assert.match(html, /statusDigest\.js/);
assert.match(renderer, /window\.winplate\.platform === "darwin"/);
assert.match(renderer, /renderMacFloating/);
assert.match(renderer, /macPlatformSettings/);
assert.match(renderer, /app-titlebar[\s\S]*isMac/);
~~~

- [ ] **Step 2: Verify failure**

~~~bash
node --test src/renderer/security.test.js
~~~

Expected: FAIL because platform branches are absent.

- [ ] **Step 3: Establish safe renderer state**

Load statusDigest.js before app.js. Add isMac from the preload platform and applicationSettings with the five defaults. Add hydrateAppSettings to the existing main-window startup Promise.all. For the macOS floating view, await hydrateAppSettings before its first render/refresh so saved pin state is reflected immediately; keep the current immediate Windows floating startup.

- [ ] **Step 4: Preserve Windows title bar and omit it on macOS**

Build the current app-titlebar markup only when isMac is false. Bind minimize/maximize/close only when the controls exist. Add platform-darwin or platform-win32 to body classes.

- [ ] **Step 5: Add live macOS settings**

macPlatformSettings returns controls for menuBarEnabled, menuBarDisplay icon/compact, desktopCapsuleEnabled, desktopCapsulePinned, and launchAtLogin. bindAppSettings accepts only those five names, saves the complete normalized object, and refreshes Settings. Windows keeps the current General section.

- [ ] **Step 6: Add explicit compact capsule rendering**

Keep the existing body unchanged as renderWindowsFloating. renderMacFloating creates four buttons for heart, weather, Codex, and attention count plus one pin button. Metric buttons open Heart, QWeather, Codex, or Dashboard. Pin saves desktopCapsulePinned through app settings. macOS updateFloatingStatusDom rerenders this compact view; Windows retains the synchronized update path and Tooltips.

- [ ] **Step 7: Add only platform-scoped CSS**

Use:

~~~css
.main-body.platform-darwin .main-window-shell { grid-template-rows: minmax(0, 1fr); background: transparent; }
.main-body.platform-darwin .workspace { padding-top: 52px; background-color: color-mix(in srgb, var(--main-bg) 82%, transparent); }
.main-body.platform-darwin .sidebar { padding-top: 12px; backdrop-filter: blur(28px); }
.platform-darwin .mac-floating-shell { width: 100%; height: 100%; display: grid; grid-template-columns: repeat(4, 1fr) 34px; align-items: center; gap: 4px; padding: 8px 10px; border: 1px solid rgba(255,255,255,.14); border-radius: 22px; background: rgba(24,24,27,.74); backdrop-filter: blur(24px); }
~~~

Add focus, hover, text-overflow, and Settings control styles beneath these selectors. Do not change Windows selectors.

- [ ] **Step 8: Run and commit**

~~~bash
node --test src/renderer/security.test.js
npm run check
git add src/renderer/index.html src/renderer/app.js src/renderer/styles.css src/renderer/security.test.js
git commit -m "feat: adapt main and capsule UI per platform"
~~~

### Task 9: Full verification and documentation

**Files:**
- Modify: README.md
- Create: docs/verification/windows-macos-smoke.md

- [ ] **Step 1: Document platform behavior**

State exact Windows 460x104 and macOS popover 380x540/capsule 360x84 behavior. State that this iteration produces no DMG, signing, or notarization and that Windows receives automated adapter coverage rather than real-device verification.

- [ ] **Step 2: Run automated verification**

~~~bash
npm run check
npm run backend:test
git diff --check
~~~

Expected: all JavaScript, Node, Python, and whitespace checks pass.

- [ ] **Step 3: Run macOS smoke verification**

~~~bash
npm run dev
~~~

Record observed results for first launch, left/right Tray clicks, blur/Escape, normal/attention/offline states, title modes, native traffic lights, close-to-hide, Dock activation, every preference, restart persistence, and optional compact capsule.

- [ ] **Step 4: Verify cleanup**

~~~bash
test ! -e design
! rg -n "design/concepts|winplate-quiet-glass" . --glob '!docs/superpowers/**'
git diff --check
~~~

Expected: no concept files or live references remain.

- [ ] **Step 5: Commit verification evidence**

~~~bash
git add README.md docs/verification/windows-macos-smoke.md
git commit -m "docs: verify Windows and macOS behavior"
~~~

- [ ] **Step 6: Run final clean checks**

~~~bash
npm run check
npm run backend:test
git diff --check
git status --short
~~~

Expected: all checks pass and the worktree is clean.
