const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const registry = require("../../shared/moduleRegistry");

test("native renderer module entry registers every current module", async () => {
  global.window = { WinPlateModuleRegistry: registry };
  const entry = pathToFileURL(path.join(__dirname, "index.mjs")).href;
  const contract = await import(pathToFileURL(path.join(__dirname, "contract.mjs")).href);
  const { rendererModules } = await import(entry);
  assert.deepEqual(rendererModules.map((module) => module.meta.id), registry.MODULES.map((module) => module.id));
  rendererModules.forEach((module) => assert.equal(contract.validateRendererModuleContract(module), module));
  delete global.window;
});
