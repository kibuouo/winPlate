const SERVICE_ENVIRONMENT_NAMES = Object.freeze([
  "QWEATHER_API_KEY",
  "QWEATHER_API_HOST",
  "QWEATHER_PROJECT_ID",
  "QWEATHER_CREDENTIAL_ID",
  "QWEATHER_PRIVATE_KEY",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "GITHUB_TOKEN",
  "QQ_MAIL_ADDRESS",
  "QQ_MAIL_AUTH_CODE",
  "QQ_MAIL_IMAP_HOST",
  "QQ_MAIL_IMAP_PORT",
  "QQ_MAIL_SMTP_HOST",
  "QQ_MAIL_SMTP_PORT"
]);

function parseRegistryValue(stdout, expectedName) {
  if (typeof stdout !== "string") return "";
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^(\S+)\s+REG_\S+\s+(.*)$/);
    if (match?.[1] === expectedName) return match[2].trim();
  }
  return "";
}

async function readWindowsServiceEnvironment(execFileAsync) {
  const entries = await Promise.all(SERVICE_ENVIRONMENT_NAMES.map(async (name) => {
    try {
      const { stdout } = await execFileAsync("reg.exe", [
        "query", "HKCU\\Environment", "/v", name
      ], { windowsHide: true });
      return [name, parseRegistryValue(stdout, name)];
    } catch {
      return [name, ""];
    }
  }));
  return Object.fromEntries(entries);
}

module.exports = {
  SERVICE_ENVIRONMENT_NAMES,
  parseRegistryValue,
  readWindowsServiceEnvironment
};
