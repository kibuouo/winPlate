# Main Page Title and GitHub Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Remove the main-content \`LIVE STATUS\` strip, lift detail-page titles, and replace the GitHub page's oversized left profile column with a compact horizontal profile bar.

**Architecture:** Keep the system clock as an absolutely positioned utility in the scroll container so it no longer consumes title space. Reshape \`githubContent()\` into a single-column page whose heading, compact profile bar, and existing content cards are separate blocks. Preserve all GitHub interaction selectors.

**Tech Stack:** Electron renderer, vanilla JavaScript template literals, CSS, Node.js test runner.

## Global Constraints

- Remove \`LIVE STATUS\` and its green dot but retain the system clock.
- Keep GitHub data loading, refresh behavior, month navigation, and \`data-open-github\` unchanged.
- Use an 88px GitHub avatar in the compact profile bar and keep the page usable below 920px.
- Do not alter the sidebar, floating status capsule, or backend APIs.

---

### Task 1: Remove the status strip without moving the clock

**Files:**
- Modify: \`apps/windows-electron/src/renderer/app.js:2788-2801\`
- Modify: \`apps/windows-electron/src/renderer/styles.css:614-621,1850\`
- Test: \`apps/windows-electron/src/renderer/security.test.js\`

**Interfaces:**
- Consumes: \`renderMain()\` and existing \`#system-clock\` update logic.
- Produces: a \`.main-content-toolbar\` containing only \`#system-clock\`.

- [ ] **Step 1: Write a failing regression test**

\`\`\`js
test("main content removes the live status strip while retaining the clock utility", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const renderMain = renderer.slice(renderer.indexOf("function renderMain()"), renderer.indexOf("\nfunction updateMainStatusDom"));
  assert.doesNotMatch(renderMain, /LIVE STATUS|live-dot/);
  assert.match(renderMain, /<header class="main-content-toolbar">[\s\S]*?<time class="system-clock" id="system-clock">/);
  assert.match(css, /\.main-content-toolbar \{[^}]*position: absolute;[^}]*top: 24px;[^}]*right: 44px;/);
  assert.match(css, /#page-content \{ padding: 30px 44px 48px; \}/);
});
\`\`\`

- [ ] **Step 2: Run the test before implementation**

Run \`node --test --test-name-pattern "main content removes the live status" apps/windows-electron/src/renderer/security.test.js\`.

Expected: FAIL because \`LIVE STATUS\` and its layout-consuming header still exist.

- [ ] **Step 3: Replace the main header markup and styles**

In \`renderMain()\`, replace the status header with:

\`\`\`js
<header class="main-content-toolbar">
  <time class="system-clock" id="system-clock">
    <span class="system-date"></span>
    <span class="system-time"></span>
  </time>
</header>
\`\`\`

Replace the generic header styles with:

\`\`\`css
.main-content { position: relative; overflow: auto; }
.main-content-toolbar { position: absolute; z-index: 1; top: 24px; right: 44px; pointer-events: none; }
.main-content time { font-variant-numeric: tabular-nums; }
#page-content { padding: 30px 44px 48px; }
@media (max-width: 920px) {
  .main-content-toolbar { top: 20px; right: 28px; }
  #page-content { padding: 24px 28px 36px; }
}
\`\`\`

- [ ] **Step 4: Verify and commit the toolbar change**

\`\`\`powershell
node --test --test-name-pattern "main content removes the live status" apps/windows-electron/src/renderer/security.test.js
npm run check:syntax --workspace @winplate/windows-electron
git add -- apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js
git commit -m "style: lift detail content above status header"
\`\`\`

Expected: tests and syntax checks pass before the commit.

### Task 2: Replace the GitHub sidebar with a compact profile bar

**Files:**
- Modify: \`apps/windows-electron/src/renderer/app.js:1238-1302\`
- Modify: \`apps/windows-electron/src/renderer/styles.css:1034-1058,1847-1858\`
- Test: \`apps/windows-electron/src/renderer/security.test.js\`

**Interfaces:**
- Consumes: \`normalizeGithub()\`, \`avatarMarkup()\`, \`data-open-github\`, \`#refresh-github\`, and \`data-month-direction\` controls.
- Produces: \`.github-profile-bar\`, \`.github-profile-identity\`, \`.github-profile-metrics\`, and \`.github-content-stack\`.

- [ ] **Step 1: Write a failing GitHub layout regression test**

\`\`\`js
test("GitHub detail uses a compact horizontal profile bar", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const githubContent = renderer.slice(renderer.indexOf("function githubContent()"), renderer.indexOf("\nconst previewIcons"));
  assert.match(githubContent, /class="github-profile-bar"/);
  assert.match(githubContent, /class="github-profile-identity"/);
  assert.match(githubContent, /class="github-content-stack"/);
  assert.match(githubContent, /data-open-github/);
  assert.match(githubContent, /id="refresh-github"/);
  assert.match(css, /\.github-dashboard \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.github-profile-avatar \{[^}]*width: 88px;[^}]*height: 88px;/);
  assert.match(css, /\.github-profile-bar \{[^}]*display: flex;[^}]*flex-wrap: wrap;/);
});
\`\`\`

- [ ] **Step 2: Run the test before implementation**

Run \`node --test --test-name-pattern "GitHub detail uses a compact horizontal profile bar" apps/windows-electron/src/renderer/security.test.js\`.

Expected: FAIL because the renderer still has \`.github-profile-column\` and a two-column grid.

- [ ] **Step 3: Restructure \`githubContent()\`**

Render the existing \`.github-page-heading\` before a \`.github-profile-bar\`. The bar must contain the existing avatar, name, username, live note, three metrics, and the existing \`data-open-github\` button. Use \`.github-profile-identity\` for the name/user/live note and preserve every current text interpolation and button attribute. Wrap \`stateNotice\`, the pinned repository article, contribution calendar article, and activity article in \`.github-content-stack\`. Retain \`id="refresh-github"\` and all \`data-month-direction\` controls.

- [ ] **Step 4: Replace the two-column styles**

\`\`\`css
.github-dashboard { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; max-width: 1120px; margin: 0 auto; }
.github-profile-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 16px 22px; padding: 18px 20px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface-card); box-shadow: 0 14px 32px var(--shadow); }
.github-profile-avatar { width: 88px; height: 88px; flex: 0 0 88px; aspect-ratio: 1; border: 1px solid var(--border); box-shadow: 0 12px 28px var(--shadow); }
.github-profile-avatar .avatar-fallback { font-size: 28px; }
.github-profile-identity { min-width: 150px; display: grid; gap: 3px; }
.github-profile-identity h1 { margin: 0; font-size: 22px; letter-spacing: -.035em; }
.github-profile-identity p { margin: 0; color: var(--text-muted); font-size: 13px; }
.github-profile-metrics { flex: 1 1 280px; display: grid; grid-template-columns: repeat(3, minmax(72px, 1fr)); gap: 12px; margin: 0; }
.github-profile-metrics div { display: grid; gap: 4px; padding: 0; border: 0; }
.github-profile-metrics dt { font-size: 18px; font-weight: 750; }
.github-profile-metrics dd { margin: 0; color: var(--text-muted); font-size: 11px; }
.github-profile-button { width: auto; margin: 0; padding: 10px 14px; }
.github-live-note { margin-top: 6px; padding: 0; background: transparent; }
.github-content-stack { min-width: 0; display: grid; gap: 16px; }
@media (max-width: 920px) {
  .github-profile-bar { align-items: flex-start; }
  .github-profile-metrics { flex-basis: 100%; }
}
@media (max-width: 560px) {
  .github-profile-bar { align-items: stretch; }
  .github-profile-avatar { width: 72px; height: 72px; flex-basis: 72px; }
  .github-profile-button { width: 100%; }
}
\`\`\`

- [ ] **Step 5: Verify and commit the GitHub change**

\`\`\`powershell
node --test --test-name-pattern "main content removes the live status|GitHub detail uses a compact horizontal profile bar" apps/windows-electron/src/renderer/security.test.js
node --test apps/windows-electron/src/renderer/security.test.js
npm run check:syntax --workspace @winplate/windows-electron
git diff --check
git add -- apps/windows-electron/src/renderer/app.js apps/windows-electron/src/renderer/styles.css apps/windows-electron/src/renderer/security.test.js
git commit -m "style: compact GitHub profile layout"
\`\`\`

Expected: all verification commands exit with code 0 and \`git diff --check\` emits no whitespace errors.
