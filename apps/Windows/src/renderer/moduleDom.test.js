const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { syncRequestedModuleNodes } = require("./moduleDom");

test("module refresh updates only the requested root and preserves interaction state", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <main id="page" style="height:20px;overflow:auto">
      <section data-module-id="mail"><input id="query"><details id="drawer" open><summary>邮件</summary><strong>旧邮件</strong></details></section>
      <section data-module-id="github"><strong>旧 GitHub</strong></section>
    </main>
  </body>`, { pretendToBeVisual: true });
  const document = dom.window.document;
  const page = document.querySelector("#page");
  page.scrollTop = 17;
  const input = document.querySelector("#query");
  input.focus();
  const desired = document.createElement("template");
  desired.innerHTML = `
    <section data-module-id="mail"><input id="query"><details><summary>邮件</summary><strong>新邮件</strong></details></section>
    <section data-module-id="github"><strong>新 GitHub</strong></section>`;

  syncRequestedModuleNodes(page, desired.content, ["github"], (current, next) => {
    current.querySelector("strong").textContent = next.querySelector("strong").textContent;
    return false;
  });

  assert.equal(document.querySelector('[data-module-id="github"] strong').textContent, "新 GitHub");
  assert.equal(document.querySelector('[data-module-id="mail"] strong').textContent, "旧邮件");
  assert.equal(document.activeElement, input);
  assert.equal(document.querySelector("#drawer").open, true);
  assert.equal(page.scrollTop, 17);
});

test("ignores a mismatched module shape instead of replacing the page", () => {
  const dom = new JSDOM(`<main><section data-module-id="weather">current</section></main>`);
  const document = dom.window.document;
  const desired = document.createElement("template");
  desired.innerHTML = `<section data-module-id="weather">one</section><section data-module-id="weather">two</section>`;
  let calls = 0;
  const changed = syncRequestedModuleNodes(document, desired.content, ["weather"], () => {
    calls += 1;
  });
  assert.equal(changed, false);
  assert.equal(calls, 0);
  assert.equal(document.querySelector('[data-module-id="weather"]').textContent, "current");
});
