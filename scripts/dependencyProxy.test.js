const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");

test("Electron builder downloads and verifies artifacts through its overridden proxy dependency", { timeout: 10_000 }, async (t) => {
  const payload = Buffer.from("WinPlate proxy download fixture");
  const requests = [];
  const proxy = http.createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(200, { "content-length": payload.length });
    response.end(payload);
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    proxy.closeAllConnections();
    proxy.close();
  });
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "winplate-dependency-proxy-"));
  t.after(async () => {
    assert.equal(path.dirname(cacheRoot), path.resolve(os.tmpdir()));
    assert.ok(path.basename(cacheRoot).startsWith("winplate-dependency-proxy-"));
    await fs.rm(cacheRoot, { recursive: true, force: true });
  });
  // This test runs in its own Node test process; it never changes the user's
  // environment or the proxy settings of the application.
  process.env.GLOBAL_AGENT_HTTP_PROXY = `http://127.0.0.1:${proxy.address().port}`;
  process.env.GLOBAL_AGENT_HTTPS_PROXY = "";
  process.env.GLOBAL_AGENT_NO_PROXY = "";
  const builderRequire = createRequire(require.resolve("app-builder-lib/package.json"));
  const downloader = builderRequire("@electron/get");
  downloader.initializeProxy();
  const filename = "electron-v44.4.3-win32-x64.zip";
  const url = `http://electron-mirror.invalid/v44.4.3/${filename}`;
  const artifact = await downloader.downloadArtifact({
    version: "44.4.3",
    platform: "win32",
    arch: "x64",
    artifactName: "electron",
    cacheRoot,
    force: true,
    checksums: { [filename]: createHash("sha256").update(payload).digest("hex") },
    mirrorOptions: { resolveAssetURL: () => url },
    downloadOptions: { retry: { limit: 0 }, timeout: { request: 5_000 } }
  });
  assert.deepEqual(await fs.readFile(artifact), payload);
  assert.deepEqual(requests, [url]);
});
