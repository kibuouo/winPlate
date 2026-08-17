const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const TOKEN_FILE_NAME = "health-sync-token.json";

function isUsableToken(value) {
  return typeof value === "string" && value.length >= 16;
}

function encryptToken(token, safeStorage) {
  if (!safeStorage?.isEncryptionAvailable?.() || typeof safeStorage.encryptString !== "function") {
    throw new Error("Secure credential storage is unavailable");
  }
  return Buffer.from(safeStorage.encryptString(token)).toString("base64");
}

function decryptToken(ciphertext, safeStorage) {
  if (!ciphertext || typeof safeStorage?.decryptString !== "function") return "";
  try {
    return safeStorage.decryptString(Buffer.from(ciphertext, "base64"));
  } catch {
    return "";
  }
}

async function writeToken(tokenPath, token, safeStorage) {
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, JSON.stringify({
    version: 2,
    token: encryptToken(token, safeStorage)
  }), "utf8");
}

async function loadOrCreateHealthSyncToken(userDataPath, safeStorage) {
  const tokenPath = path.join(userDataPath, TOKEN_FILE_NAME);
  try {
    const stored = JSON.parse(await fs.readFile(tokenPath, "utf8"));
    const decrypted = decryptToken(stored?.token, safeStorage);
    if (isUsableToken(decrypted)) return decrypted;
    if (stored?.version === 1 && isUsableToken(stored?.token)) {
      await writeToken(tokenPath, stored.token, safeStorage);
      return stored.token;
    }
  } catch {
    // Recreate the token when the file is missing, unreadable, or stale.
  }

  const token = crypto.randomBytes(24).toString("base64url");
  await writeToken(tokenPath, token, safeStorage);
  return token;
}

module.exports = { TOKEN_FILE_NAME, loadOrCreateHealthSyncToken };
