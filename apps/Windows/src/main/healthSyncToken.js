const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const TOKEN_FILE_NAME = "health-sync-token.json";

async function loadOrCreateHealthSyncToken(userDataPath) {
  const tokenPath = path.join(userDataPath, TOKEN_FILE_NAME);
  try {
    const stored = JSON.parse(await fs.readFile(tokenPath, "utf8"));
    if (typeof stored?.token === "string" && stored.token.length >= 16) return stored.token;
  } catch {
    // The token is recreated below when the file is missing or invalid.
  }

  const token = crypto.randomBytes(24).toString("base64url");
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.writeFile(tokenPath, JSON.stringify({ version: 1, token }), "utf8");
  return token;
}

module.exports = { loadOrCreateHealthSyncToken };
