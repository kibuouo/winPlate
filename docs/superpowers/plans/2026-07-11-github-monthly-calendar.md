# GitHub Monthly Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the undersized split heatmap with a full-width, paged monthly activity calendar that uses the entire primary card.

**Architecture:** Rework `githubContributionCalendar(month)` into a conventional seven-column month grid whose cells carry both date numbers and contribution intensity. Remove the parallel monthly-summary card and render the existing summary data as a compact footer inside the calendar card; leave profile, refresh, repository, activity, and month-navigation contracts intact.

**Tech Stack:** Electron renderer template strings, plain CSS, Node.js built-in test runner.

## Global Constraints

- Use one full-width monthly calendar card under the GitHub profile strip.
- Retain `data-month-direction`, contribution tooltips, keyboard focus, and current month selection behavior.
- Calendar cells are rounded squares between 28px and 36px on wide screens and include the day number.
- Put contribution total, active days, best day, and day streak in a divider-separated footer inside the same card.
- Do not change the GitHub API contract or refresh/profile-opening controls.

---

### Task 1: Add failing contracts for a full monthly calendar

**Files:**
- Modify: `apps/windows-electron/src/renderer/security.test.js`
- Test target: `apps/windows-electron/src/renderer/security.test.js`

**Interfaces:**
- Consumes: `app.js` and `styles.css` as source text.
- Produces: assertions preventing a split summary panel and undersized calendar grid from returning.

- [ ] **Step 1: Add the failing test**

```js
test("GitHub contribution view is a full monthly calendar with in-card summary stats", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const calendar = extractNamedFunction(renderer, "githubContributionCalendar");
  const githubStart = renderer.indexOf("function githubContent()");
  const githubEnd = renderer.indexOf("\nconst previewIcons", githubStart);
  const github = renderer.slice(githubStart, githubEnd);

  assert.match(calendar, /github-calendar-weekdays/);
  assert.match(calendar, /github-calendar-day/);
  assert.match(github, /class="github-calendar-stats"/);
  assert.doesNotMatch(github, /class="github-month-summary-card"/);
  assert.match(css, /\.github-calendar-grid\s*\{[^}]*grid-template-columns:\s*repeat\(7,/);
  assert.match(css, /grid-auto-rows:\s*clamp\(28px,\s*5\.5vw,\s*36px\)/);
  assert.match(css, /\.github-calendar-stats\s*\{[^}]*grid-template-columns:\s*repeat\(4,/);
});
```

- [ ] **Step 2: Verify it fails**

Run: `node --test --test-name-pattern="GitHub contribution view is a full monthly calendar" src/renderer/security.test.js`

Expected: FAIL because the current renderer still has `.github-month-summary-card` and the heatmap is a 7-row, auto-column grid.

### Task 2: Render calendar days as date-labelled month cells

**Files:**
- Modify: `apps/windows-electron/src/renderer/app.js:1186-1214`

**Interfaces:**
- Consumes: `month.key`, `month.label`, `month.levels`, and `month.counts`.
- Produces: `.github-calendar-weekdays`, `.github-calendar-grid`, and `.github-calendar-day` elements.

- [ ] **Step 1: Replace `githubContributionCalendar(month)`**

```js
function githubContributionCalendar(month) {
  const values = month.levels || [];
  const counts = month.counts || [];
  const firstDay = new Date(`${month.key}-01T00:00:00`).getDay();
  const mondayOffset = (firstDay + 6) % 7;
  const cellCount = Math.ceil((mondayOffset + values.length) / 7) * 7;
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const sourceIndex = index - mondayOffset;
    const active = sourceIndex >= 0 && sourceIndex < values.length;
    if (!active) return `<span class="github-calendar-cell level-0 outside-month" aria-hidden="true"></span>`;
    const level = Math.max(0, Math.min(4, Number(values[sourceIndex]) || 0));
    const count = Math.max(0, Number(counts[sourceIndex]) || 0);
    const date = new Date(`${month.key}-${String(sourceIndex + 1).padStart(2, "0")}T00:00:00`);
    const dateLabel = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(date);
    const contributionLabel = `${count} contribution${count === 1 ? "" : "s"} on ${dateLabel}.`;
    return `<span class="github-calendar-cell github-calendar-day level-${level}" tabindex="0" aria-label="${contributionLabel}" data-tooltip="${contributionLabel}"><b>${sourceIndex + 1}</b></span>`;
  }).join("");
  return `<div class="github-calendar-shell"><div class="github-calendar-weekdays" aria-hidden="true"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div><div class="github-calendar-grid" aria-label="GitHub contributions for ${month.label}">${cells}</div></div>`;
}
```

- [ ] **Step 2: Run the focused test**

Run: `node --test --test-name-pattern="GitHub contribution view is a full monthly calendar" src/renderer/security.test.js`

Expected: FAIL only because the old split summary card and CSS remain.

### Task 3: Turn the contribution panel into the full-width primary card

**Files:**
- Modify: `apps/windows-electron/src/renderer/app.js:1282-1310`
- Modify: `apps/windows-electron/src/renderer/styles.css:1060-1130, 1860-1885`

**Interfaces:**
- Consumes: `monthSummary`, `github.streakDays`, `githubContributionCalendar(selectedMonth)`, and existing month navigation.
- Produces: a full-width `.github-contribution-card` with `.github-calendar-stats`; `.github-detail-grid` remains below it.

- [ ] **Step 1: Replace the split overview markup**

Replace the `.github-activity-overview` wrapper and its two articles with this single article:

```html
<article class="github-contribution-card">
  <div class="github-card-heading">
    <div><span>Activity calendar</span><small>${monthSummary.contributions} contributions in ${selectedMonth.label}</small></div>
    <div class="github-month-navigation">
      <button type="button" data-month-direction="-1" aria-label="Previous month" ${monthIndex === 0 ? "disabled" : ""}>‹</button>
      <strong>${selectedMonth.label}</strong>
      <button type="button" data-month-direction="1" aria-label="Next month" ${monthIndex === months.length - 1 ? "disabled" : ""}>›</button>
    </div>
  </div>
  ${githubContributionCalendar(selectedMonth)}
  <div class="github-calendar-stats">
    <div><strong>${monthSummary.contributions}</strong><span>contributions</span></div>
    <div><strong>${monthSummary.activeDays}</strong><span>active days</span></div>
    <div><strong>${monthSummary.peakDaily}</strong><span>best day</span></div>
    <div><strong>${github.streakDays}</strong><span>day streak</span></div>
  </div>
</article>
```

Keep the existing `.github-detail-grid` immediately after this article.

- [ ] **Step 2: Replace heatmap and overview CSS**

```css
.github-activity-overview { display: block; }
.github-contribution-card { padding: 20px; }
.github-card-heading > div:first-child { display: grid; gap: 4px; }
.github-card-heading > div:first-child > small { padding: 0; border: 0; border-radius: 0; }
.github-calendar-shell { display: grid; gap: 8px; }
.github-calendar-weekdays, .github-calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
.github-calendar-weekdays { color: var(--text-muted); font-size: 10px; font-weight: 700; text-align: center; }
.github-calendar-grid { grid-auto-rows: clamp(28px, 5.5vw, 36px); }
.github-calendar-cell { display: grid; place-items: start; min-width: 0; padding: 5px; border-radius: 9px; }
.github-calendar-day b { color: var(--text-muted); font-size: 10px; font-weight: 750; line-height: 1; }
.github-calendar-cell.level-3 b, .github-calendar-cell.level-4 b { color: #fff; }
.github-calendar-cell.outside-month { opacity: 0; }
.github-calendar-legend { display: none; }
.github-calendar-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 18px; border-top: 1px solid var(--border); }
.github-calendar-stats > div { display: grid; gap: 3px; padding: 14px 12px 0; border-right: 1px solid var(--border); }
.github-calendar-stats > div:first-child { padding-left: 0; }
.github-calendar-stats > div:last-child { border-right: 0; }
.github-calendar-stats strong { font-size: 19px; font-variant-numeric: tabular-nums; }
.github-calendar-stats span { color: var(--text-muted); font-size: 10px; }
```

Delete the old `.github-calendar-labels`, `.github-calendar`, `.github-calendar-months`, `.github-month-summary-card`, `.github-summary-label`, and `.github-calendar-legend` layout rules. Keep the existing tooltip rules, updating only selectors that depend on the old auto-column grid.

- [ ] **Step 3: Add mobile rules**

Inside `@media (max-width: 560px)`, add:

```css
.github-contribution-card { padding: 16px; }
.github-calendar-weekdays, .github-calendar-grid { gap: 5px; }
.github-calendar-grid { grid-auto-rows: clamp(28px, 10vw, 34px); }
.github-calendar-cell { padding: 4px; border-radius: 7px; }
.github-calendar-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 14px; }
.github-calendar-stats > div:nth-child(2) { border-right: 0; }
.github-calendar-stats > div:nth-child(3) { padding-left: 0; }
```

- [ ] **Step 4: Run focused tests**

Run: `node --test --test-name-pattern="GitHub contribution view is a full monthly calendar|GitHub month summary derives" src/renderer/security.test.js`

Expected: PASS.

### Task 4: Verify and commit

**Files:**
- Verify: `apps/windows-electron/src/renderer/app.js`
- Verify: `apps/windows-electron/src/renderer/styles.css`
- Verify: `apps/windows-electron/src/renderer/security.test.js`

- [ ] **Step 1: Run syntax validation**

Run: `npm run check:syntax --workspace @winplate/windows-electron`

Expected: PASS.

- [ ] **Step 2: Run complete tests**

Run: `npm test --workspace @winplate/windows-electron`

Expected: PASS with zero failures.

- [ ] **Step 3: Inspect scope**

Run: `git diff --check; git diff -- apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js`

Expected: no whitespace errors and only calendar redesign files changed.

- [ ] **Step 4: Commit**

```bash
git add apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js docs/superpowers/plans/2026-07-11-github-monthly-calendar.md
git commit -m "feat: redesign GitHub monthly activity calendar"
```
