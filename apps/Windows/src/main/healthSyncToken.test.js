const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { loadOrCreateHealthSyncToken } = require("./healthSyncToken");

function createSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (buffer) => {
      const text = Buffer.from(buffer).toString("utf8");
      if (!text.startsWith("enc:")) throw new Error("invalid ciphertext");
      return text.slice(4);
    }
  };
}

test("encrypts newly created health sync tokens", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "winplate-health-token-"));
  try {
    const token = await loadOrCreateHealthSyncToken(directory, createSafeStorage());
    const stored = JSON.parse(await fs.readFile(path.join(directory, "health-sync-token.json"), "utf8"));
    assert.equal(stored.version, 2);
    assert.notEqual(stored.token, token);
    assert.equal(await loadOrCreateHealthSyncToken(directory, createSafeStorage()), token);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("migrates a plaintext health sync token into encrypted storage", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "winplate-health-token-"));
  try {
    const tokenPath = path.join(directory, "health-sync-token.json");
    await fs.writeFile(tokenPath, JSON.stringify({
      version: 1,
      token: "legacy-health-sync-token"
    }), "utf8");
    const token = await loadOrCreateHealthSyncToken(directory, createSafeStorage());
    const stored = JSON.parse(await fs.readFile(tokenPath, "utf8"));
    assert.equal(token, "legacy-health-sync-token");
    assert.equal(stored.version, 2);
    assert.notEqual(stored.token, token);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
