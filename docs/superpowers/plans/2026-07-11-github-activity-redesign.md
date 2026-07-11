# GitHub Activity Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the main-content clock gap and rebuild the GitHub detail page as a compact, heatmap-preserving activity overview.

**Architecture:** Keep the system clock rendered once in the main shell, but position it absolutely so it does not reserve vertical space. Reorder `githubContent()` into a title-first single-column flow; derive a small monthly summary from the selected contribution month and display the compact heatmap alongside it.

**Tech Stack:** Electron renderer HTML template strings, plain CSS, Node.js built-in test runner, existing renderer source-contract tests.

## Global Constraints

- The system clock remains visible in the upper-right main content area but does not occupy document-flow height.
- GitHub’s title comes before profile information and reads `GitHub activity`.
- Keep the contribution heatmap, month navigation, contribution tooltips, refresh control, and `data-open-github` behavior.
- Use a 72px GitHub avatar and a profile strip no taller than approximately 96px on wide screens.
- Derive monthly totals from the existing selected month data without changing the GitHub API contract.
- On narrow screens, stack all GitHub overview and detail cards in reading order.

---

### Task 1: Add failing renderer contracts for the redesigned hierarchy

**Files:**
- Modify: `apps/windows-electron/src/renderer/security.test.js`
- Test target: `apps/windows-electron/src/renderer/security.test.js`

**Interfaces:**
- Consumes: renderer and CSS source text.
- Produces: tests that prevent the clock gap, profile-first order, and stretched heatmap from returning.

- [ ] **Step 1: Add a source-contract test**

Append this test:

```js
test("GitHub activity page keeps the clock out of flow and uses a compact heatmap overview", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const githubStart = renderer.indexOf("function githubContent()");
  const githubEnd = renderer.indexOf("\nconst previewIcons", githubStart);
  const github = renderer.slice(githubStart, githubEnd);

  assert.match(css, /\.main-content\s*\{[^}]*position:\s*relative;/);
  assert.match(css, /\.main-content-header\s*\{[^}]*position:\s*absolute;/);
  assert.match(css, /\.github-calendar-grid\s*\{[^}]*grid-auto-columns:\s*12px;/);
  assert.match(github, /const monthSummary = githubMonthSummary\(selectedMonth\);/);
  assert.match(github, /<h2>GitHub activity<\/h2>/);
  assert.match(github, /class="github-activity-overview"/);
  assert.match(github, /class="github-month-summary-card"/);
  assert.ok(github.indexOf("github-page-heading") < github.indexOf("github-profile-bar"));
});
```

- [ ] **Step 2: Run it and verify the current implementation fails**

Run: `node --test --test-name-pattern="GitHub activity page keeps the clock out of flow" src/renderer/security.test.js`

Expected: FAIL because the current clock header has a minimum height, the profile appears before the title, and the heatmap columns flex across the full card.

### Task 2: Remove the clock gap and derive selected-month summary data

**Files:**
- Modify: `apps/windows-electron/src/renderer/app.js:1215-1236`
- Modify: `apps/windows-electron/src/renderer/styles.css:614-620`

**Interfaces:**
- Consumes: selected `month` values containing `commits`, `counts`, and `levels`.
- Produces: `githubMonthSummary(month)` returning `{ contributions, activeDays, peakDaily }`, plus a zero-height-flow system clock.

- [ ] **Step 1: Add the selected-month summary helper before `githubContent()`**

```js
function githubMonthSummary(month) {
  const counts = Array.isArray(month?.counts) ? month.counts : [];
  const normalizedCounts = counts.map((value) => Math.max(0, Number(value) || 0));
  return {
    contributions: Math.max(0, Number(month?.commits) || 0),
    activeDays: normalizedCounts.filter((count) => count > 0).length,
    peakDaily: normalizedCounts.length ? Math.max(...normalizedCounts) : 0
  };
}
```

- [ ] **Step 2: Change the selected month setup**

Immediately after `const activityCount = selectedMonth.commits || 0;`, add:

```js
  const monthSummary = githubMonthSummary(selectedMonth);
```

- [ ] **Step 3: Make the system clock an overlay**

Replace the current content header and page padding rules with:

```css
.main-content { position: relative; overflow: auto; }
.main-content-header { position: absolute; z-index: 3; top: 30px; right: 44px; min-height: 0; padding: 0; display: flex; color: var(--text-muted); font-size: 10px; font-weight: 750; letter-spacing: .12em; pointer-events: none; }
.main-content-header time { font-variant-numeric: tabular-nums; }
#page-content { padding: 30px 44px 48px; }
```

- [ ] **Step 4: Run the focused contract test**

Run: `node --test --test-name-pattern="GitHub activity page keeps the clock out of flow" src/renderer/security.test.js`

Expected: still FAIL only for the missing title-first overview markup and heatmap size.

### Task 3: Recompose GitHub into title, profile, activity overview, and detail grid

**Files:**
- Modify: `apps/windows-electron/src/renderer/app.js:1236-1304`
- Modify: `apps/windows-electron/src/renderer/styles.css:1033-1123, 1850-1865`

**Interfaces:**
- Consumes: `monthSummary`, `githubContributionCalendar(selectedMonth)`, existing refresh and navigation controls, and `data-open-github` buttons.
- Produces: `.github-activity-overview`, `.github-month-summary-card`, and `.github-detail-grid` while retaining existing controls.

- [ ] **Step 1: Move the heading ahead of the profile strip**

Within the returned `githubContent()` template, make `.github-main-column` the only direct child of `.github-dashboard`. Place the existing state notice first, then replace the heading with:

```html
<div class="github-page-heading">
  <div><p>GITHUB</p><h2>GitHub activity</h2><span>Monthly contribution rhythm and project activity for ${github.username}.</span></div>
  <button class="refresh-button github-refresh-button ${githubRefreshInFlight ? "refreshing" : ""}" id="refresh-github" type="button" aria-label="刷新 GitHub 数据" ${githubRefreshInFlight ? "disabled" : ""}>
    ${refreshIcon}<span>${githubRefreshInFlight ? "刷新中" : "刷新"}</span>
  </button>
</div>
```

Follow it with the existing profile bar markup, changing its avatar argument to `github-profile-avatar` without changing the `data-open-github` button.

- [ ] **Step 2: Replace the separate contribution and detail cards with two grids**

After the profile bar, add:

```html
<div class="github-activity-overview">
  <article class="github-contribution-card">
    <div class="github-card-heading">
      <span>${monthSummary.contributions} contributions in ${selectedMonth.label}</span>
      <div class="github-month-navigation">
        <button type="button" data-month-direction="-1" aria-label="Previous month" ${monthIndex === 0 ? "disabled" : ""}>‹</button>
        <strong>${selectedMonth.label}</strong>
        <button type="button" data-month-direction="1" aria-label="Next month" ${monthIndex === months.length - 1 ? "disabled" : ""}>›</button>
      </div>
    </div>
    ${githubContributionCalendar(selectedMonth)}
    <div class="github-calendar-legend"><span>Less</span>${[0, 1, 2, 3, 4].map((level) => `<i class="github-calendar-cell level-${level}"></i>`).join("")}<span>More</span></div>
  </article>
  <article class="github-month-summary-card">
    <span class="github-summary-label">MONTHLY SUMMARY</span>
    <strong>${monthSummary.contributions}</strong><small>contributions this month</small>
    <dl>
      <div><dt>${monthSummary.activeDays}</dt><dd>active days</dd></div>
      <div><dt>${monthSummary.peakDaily}</dt><dd>best day</dd></div>
      <div><dt>${github.streakDays}</dt><dd>day streak</dd></div>
    </dl>
  </article>
</div>
<div class="github-detail-grid">
  <!-- retain the existing pinned repository article here -->
  <!-- retain the existing contribution activity article here -->
</div>
```

Use the complete existing pinned-repository and contribution-activity markup in place of the two HTML comments; do not change their buttons, labels, or icon references.

- [ ] **Step 3: Apply compact layout CSS**

Replace the GitHub page rules with these key rules, retaining existing tooltip styles:

```css
.github-dashboard, .github-main-column { min-width: 0; display: grid; gap: 16px; max-width: 1120px; margin: 0 auto; }
.github-page-heading { min-height: 72px; padding-right: 138px; margin: 0; }
.github-profile-bar { min-height: 96px; padding: 12px 16px; }
.github-profile-avatar { width: 72px; height: 72px; flex-basis: 72px; }
.github-activity-overview { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(210px, .8fr); gap: 16px; }
.github-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.github-contribution-card, .github-month-summary-card, .github-pinned-card, .github-activity-card { min-height: 0; padding: 18px; }
.github-month-summary-card { display: grid; align-content: start; gap: 5px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface-card); box-shadow: 0 14px 32px var(--shadow); }
.github-month-summary-card > strong { margin-top: 8px; font-size: 38px; line-height: 1; letter-spacing: -.05em; }
.github-month-summary-card > small, .github-summary-label, .github-month-summary-card dd { color: var(--text-muted); }
.github-summary-label { font-size: 10px; font-weight: 800; letter-spacing: .16em; }
.github-month-summary-card dl { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 16px 0 0; padding-top: 14px; border-top: 1px solid var(--border); }
.github-month-summary-card dl div { display: grid; gap: 2px; }
.github-month-summary-card dt { font-size: 16px; font-weight: 750; }
.github-month-summary-card dd { margin: 0; font-size: 10px; }
.github-calendar-grid { grid-auto-columns: 12px; justify-content: start; }
```

- [ ] **Step 4: Add responsive stacking rules**

Inside the existing `@media (max-width: 920px)` block add:

```css
.main-content-header { top: 24px; right: 28px; }
#page-content { padding: 24px 28px 34px; }
.github-page-heading { padding-right: 128px; }
.github-activity-overview, .github-detail-grid { grid-template-columns: 1fr; }
```

Inside `@media (max-width: 560px)` add:

```css
.main-content-header { display: none; }
.github-page-heading { min-height: 0; padding-right: 0; }
.github-profile-bar { min-height: 0; }
.github-month-summary-card dl { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.github-calendar-grid { grid-auto-columns: minmax(10px, 1fr); }
```

- [ ] **Step 5: Run the focused contract test**

Run: `node --test --test-name-pattern="GitHub activity page keeps the clock out of flow" src/renderer/security.test.js`

Expected: PASS.

### Task 4: Verify the full renderer suite and commit

**Files:**
- Verify: `apps/windows-electron/src/renderer/app.js`
- Verify: `apps/windows-electron/src/renderer/styles.css`
- Verify: `apps/windows-electron/src/renderer/security.test.js`

- [ ] **Step 1: Run syntax validation**

Run: `npm run check:syntax --workspace @winplate/windows-electron`

Expected: PASS with no `node --check` errors.

- [ ] **Step 2: Run the full Windows Electron test suite**

Run: `npm test --workspace @winplate/windows-electron`

Expected: PASS with 0 failures.

- [ ] **Step 3: Inspect scope and whitespace**

Run: `git diff --check; git diff -- apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js`

Expected: no whitespace errors; only the GitHub activity-page renderer, its styles, and tests changed.

- [ ] **Step 4: Commit the implementation**

```bash
git add apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js docs/superpowers/plans/2026-07-11-github-activity-redesign.md
git commit -m "feat: redesign GitHub activity overview"
```
