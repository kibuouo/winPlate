# Titlebar Compact Weather Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display current weather to the left of the date in the Windows main-window titlebar.

**Architecture:** Add a renderer helper that produces the titlebar weather markup from `statusData.weather`, then render it before the existing system clock. Update this small titlebar region whenever existing weather refreshes update the main view; responsive CSS hides only the condition text at narrow widths.

**Tech Stack:** Electron renderer JavaScript, CSS, Node.js built-in test runner.

## Global Constraints

- Reuse existing `statusData.weather` data and local QWeather icons; add no IPC or dependency.
- The weather group is non-interactive and exists only in the Windows custom titlebar.
- Normal width shows icon, temperature, and condition; narrow width keeps only icon and temperature.
- Keep existing date/time, drag-region, and window-control behavior intact.
- Main-window weather refreshes update the titlebar without requiring a full page rerender.

---

### Task 1: Add and refresh compact titlebar weather

**Files:**
- Modify: `apps/windows-electron/src/renderer/security.test.js:188-211`
- Modify: `apps/windows-electron/src/renderer/app.js:808-819,2838-2846,2974-2982`
- Modify: `apps/windows-electron/src/renderer/styles.css:493-501,1887-1906`

**Interfaces:**
- Consumes: `statusData.weather` with `icon`, `temperature`, and `condition` fields.
- Produces: `titlebarWeatherContent()` markup and `updateTitlebarWeather()` DOM refresh for `#titlebar-weather`.

- [ ] **Step 1: Write the failing test**

  Add one `security.test.js` test that reads the renderer and CSS files and asserts:

  ```js
  assert.match(renderMain, /id="titlebar-weather"[\s\S]*?class="titlebar-clock"/);
  assert.match(renderer, /function titlebarWeatherContent\(\)[\s\S]*?titlebar-weather-icon[\s\S]*?titlebar-weather-temperature[\s\S]*?titlebar-weather-condition/);
  assert.match(renderer, /function updateTitlebarWeather\(\)/);
  assert.match(renderer, /requested\.includes\("weather"\)\) updateTitlebarWeather\(\);/);
  assert.match(css, /\.titlebar-weather\s*\{/);
  assert.match(css, /\.titlebar-weather-icon\s*\{/);
  assert.match(css, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.titlebar-weather-condition\s*\{\s*display:\s*none;/);
  ```

- [ ] **Step 2: Run the focused test to verify it fails**

  Run:

  ```powershell
  node --test --test-name-pattern="titlebar compact weather" apps/windows-electron/src/renderer/security.test.js
  ```

  Expected: FAIL because the titlebar does not yet contain the weather group or refresh helper.

- [ ] **Step 3: Write the minimal implementation**

  Add these renderer helpers before `updateSystemClock()`:

  ```js
  function titlebarWeatherContent() {
    const weather = statusData.weather || mockStatus.weather;
    const temperature = weather.temperature ?? "--";
    const condition = weather.condition || "天气未知";
    return `${weatherIconMarkup(weather.icon, "titlebar-weather-icon")}<span class="titlebar-weather-temperature">${temperature}°</span><span class="titlebar-weather-condition">${condition}</span>`;
  }

  function updateTitlebarWeather() {
    const container = document.querySelector("#titlebar-weather");
    if (!container) return;
    container.innerHTML = titlebarWeatherContent();
    bindWeatherIconFallbacks(container);
  }
  ```

  In `renderMain()`, insert `<div class="titlebar-weather" id="titlebar-weather">${titlebarWeatherContent()}</div>` immediately before `.titlebar-clock`, and bind its icon fallback after rendering. In `updateMainStatusDom(moduleIds)`, calculate `requested` before the Settings early return and call `updateTitlebarWeather()` whenever `requested.includes("weather")`.

  Add compact CSS for `.titlebar-weather`, `.titlebar-weather-icon`, `.titlebar-weather-temperature`, and `.titlebar-weather-condition`. Inside a `max-width: 760px` media query, set `.titlebar-weather-condition { display: none; }`.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run:

  ```powershell
  node --test --test-name-pattern="titlebar compact weather" apps/windows-electron/src/renderer/security.test.js
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
  git add apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js
  git commit -m "feat: add compact titlebar weather"
  ```
