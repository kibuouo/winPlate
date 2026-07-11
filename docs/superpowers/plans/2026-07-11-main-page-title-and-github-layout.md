# Main Page Title and GitHub Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the main-window `LIVE STATUS` strip, move module titles to the top of the content surface, and redesign the GitHub detail page around a compact horizontal profile header.

**Architecture:** Keep navigation, refresh handlers, data contracts, and existing card markup semantics intact. Change only the main renderer shell, the GitHub detail composition, and the renderer CSS; preserve the clock as a right-aligned element in the content header and make GitHub’s profile column become a full-width profile bar.

**Tech Stack:** Electron renderer HTML template strings, plain CSS, Node.js built-in test runner, existing renderer source-contract tests.

## Global Constraints

- Remove the `LIVE STATUS` label and status dot from the main content header.
- Keep the system date/time visible at the top right.
- Use an approximately 88px GitHub avatar on wide screens.
- Preserve existing GitHub refresh, contribution-month navigation, and profile-opening selectors.
- Keep the layout responsive and avoid changing unrelated floating status capsule styles.

---

### Task 1: Lock the renderer contract with failing tests

**Files:**
- Modify: `apps/windows-electron/src/renderer/security.test.js`
- Test target: `apps/windows-electron/src/renderer/security.test.js`

**Interfaces:**
- Consumes: `app.js` and `styles.css` as source text.
- Produces: assertions that prevent the old main header and old two-column GitHub profile layout from returning.

- [ ] **Step 1: Add source-contract assertions**

Append tests that read the renderer and CSS files:

```js
test("main content header keeps only the clock and removes LIVE STATUS", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const renderStart = renderer.indexOf("function renderMain()");
  const renderEnd = renderer.indexOf("\nfunction updateMainStatusDom", renderStart);
  const renderMain = renderer.slice(renderStart, renderEnd);

  assert.doesNotMatch(renderMain, /LIVE STATUS/);
  assert.doesNotMatch(renderMain, /class="live-dot"/);
  assert.match(renderMain, /class="system-clock"/);
});

test("GitHub detail uses a compact profile bar and single-column dashboard", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const githubStart = renderer.indexOf("function githubContent()");
  const githubEnd = renderer.indexOf("\nconst previewIcons", githubStart);
  const github = renderer.slice(githubStart, githubEnd);

  assert.match(github, /class="github-profile-bar"/);
  assert.doesNotMatch(github, /class="github-profile-column"/);
  assert.match(css, /\.github-dashboard\s*\{[^}]*grid-template-columns:\s*1fr;/);
  assert.match(css, /\.github-profile-avatar\s*\{[^}]*width:\s*88px;/);
  assert.match(css, /\.github-profile-bar\s*\{[\s\S]*display:\s*flex/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test --workspace @winplate/windows-electron -- --test-name-pattern="main content header keeps only the clock|GitHub detail uses a compact profile bar"`

Expected: FAIL because the current renderer contains `LIVE STATUS`, `.github-profile-column`, and the 220px two-column CSS.

### Task 2: Remove the main LIVE STATUS strip and lift titles

**Files:**
- Modify: `apps/windows-electron/src/renderer/app.js:2793-2802`
- Modify: `apps/windows-electron/src/renderer/styles.css:614-617`

**Interfaces:**
- Consumes: the existing `renderMain()` template and `system-clock` update code.
- Produces: a content header with only the clock, followed immediately by `#page-content`.

- [ ] **Step 1: Replace the main header template**

Change the current header from:

```html
<header>
  <div><span class="live-dot"></span> LIVE STATUS</div>
  <time class="system-clock" id="system-clock">
```

to:

```html
<header class="main-content-header">
  <time class="system-clock" id="system-clock">
```

Keep the existing date/time spans and closing `</header>` unchanged.

- [ ] **Step 2: Reduce the header footprint while preserving the clock**

Replace the broad selector with:

```css
.main-content-header { min-height: 42px; padding: 0 34px 8px; display: flex; align-items: center; justify-content: flex-end; color: var(--text-muted); font-size: 10px; font-weight: 750; letter-spacing: .12em; }
.main-content-header time { font-variant-numeric: tabular-nums; }
```

Leave `.main-content { overflow: auto; }` intact. This removes the status row’s 64px reserved height while keeping the clock aligned to the top right.

- [ ] **Step 3: Run the focused header test**

Run: `npm test --workspace @winplate/windows-electron -- --test-name-pattern="main content header keeps only the clock"`

Expected: PASS.

### Task 3: Recompose GitHub profile content and CSS

**Files:**
- Modify: `apps/windows-electron/src/renderer/app.js:1236-1254`
- Modify: `apps/windows-electron/src/renderer/styles.css:1033-1049, 1850-1855`

**Interfaces:**
- Consumes: normalized `github` data, `avatarMarkup()`, existing `data-open-github`, `github-profile-metrics`, and `github-live-note` markup.
- Produces: `.github-profile-bar` with the same interactive selectors and a single-column `.github-dashboard`.

- [ ] **Step 1: Replace the profile column markup**

Replace the existing `github-profile-column` wrapper with:

```html
<div class="github-profile-bar">
  ${avatarMarkup(github, "github-profile-avatar")}
  <div class="github-profile-copy">
    <h1>${github.name}</h1>
    <p>${github.username}</p>
  </div>
  <dl class="github-profile-metrics">
    <div><dt>${github.repos}</dt><dd>Repositories</dd></div>
    <div><dt>${github.followers}</dt><dd>Followers</dd></div>
    <div><dt>${github.streakDays}</dt><dd>Day streak</dd></div>
  </dl>
  <div class="github-profile-actions">
    <div class="github-live-note"><span></span><div><strong>${github.status || "Live"}</strong><small>${relativeUpdatedAt(github.updatedAt)}</small></div></div>
    <button class="github-profile-button" type="button" data-open-github>Open GitHub profile</button>
  </div>
</div>
```

Keep the existing `github-main-column` immediately after this bar.

- [ ] **Step 2: Make the dashboard single-column and profile compact**

Replace the GitHub layout rules with:

```css
.github-dashboard { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; max-width: 1120px; margin: 0 auto; }
.github-profile-bar { min-width: 0; display: flex; align-items: center; gap: 16px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface-card); box-shadow: 0 14px 32px var(--shadow); }
.github-profile-avatar { width: 88px; height: 88px; flex: 0 0 88px; border: 1px solid var(--border); box-shadow: 0 12px 26px var(--shadow); }
.github-profile-avatar .avatar-fallback { font-size: 28px; }
.github-profile-copy { min-width: 150px; flex: 1 1 190px; margin-top: 0; }
.github-profile-copy h1 { margin: 0; font-size: 22px; letter-spacing: -.035em; }
.github-profile-copy p { margin: 4px 0 0; color: var(--text-muted); font-size: 13px; }
.github-profile-metrics { min-width: 250px; display: grid; grid-template-columns: repeat(3, minmax(72px, 1fr)); gap: 12px; margin: 0; border-top: 0; }
.github-profile-metrics div { display: grid; gap: 2px; padding: 0; border-bottom: 0; }
.github-profile-metrics dt { font-size: 17px; font-weight: 750; }
.github-profile-metrics dd { margin: 0; color: var(--text-muted); font-size: 10px; }
.github-profile-actions { display: grid; justify-items: end; gap: 8px; margin-left: auto; }
.github-profile-button { width: auto; margin-top: 0; padding: 8px 12px; font-size: 11px; }
.github-live-note { margin-top: 0; padding: 0; background: transparent; }
```

- [ ] **Step 3: Add responsive profile wrapping**

Inside the existing `@media (max-width: 920px)` block, replace the old `.github-dashboard` rules with:

```css
.github-profile-bar { align-items: flex-start; flex-wrap: wrap; }
.github-profile-metrics { flex: 1 1 280px; }
.github-profile-actions { margin-left: 0; }
```

Inside `@media (max-width: 560px)`, add:

```css
.github-profile-bar { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 12px; }
.github-profile-avatar { width: 64px; height: 64px; flex-basis: 64px; }
.github-profile-copy { min-width: 0; }
.github-profile-metrics { grid-column: 1 / -1; min-width: 0; }
.github-profile-actions { grid-column: 1 / -1; justify-items: stretch; }
```

- [ ] **Step 4: Run the focused GitHub test**

Run: `npm test --workspace @winplate/windows-electron -- --test-name-pattern="GitHub detail uses a compact profile bar"`

Expected: PASS.

### Task 4: Run renderer validation and review the diff

**Files:**
- Verify: `apps/windows-electron/src/renderer/app.js`
- Verify: `apps/windows-electron/src/renderer/styles.css`
- Verify: `apps/windows-electron/src/renderer/security.test.js`

- [ ] **Step 1: Run syntax validation**

Run: `npm run check:syntax --workspace @winplate/windows-electron`

Expected: PASS with no `node --check` errors.

- [ ] **Step 2: Run all renderer unit tests**

Run: `npm run test:unit --workspace @winplate/windows-electron`

Expected: PASS.

- [ ] **Step 3: Inspect the final diff for scope**

Run: `git diff --check; git diff -- apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js`

Expected: no whitespace errors; only the main content header, GitHub detail layout, related tests, and the implementation plan are changed.

- [ ] **Step 4: Commit the implementation**

```bash
git add apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js docs/superpowers/plans/2026-07-11-main-page-title-and-github-layout.md
git commit -m "feat: compact GitHub profile and lift main page titles"
```
