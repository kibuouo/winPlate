async function createServiceSettingsMigration({
  platform,
  hasPersistedSettings,
  readStoredSettings,
  writeStoredSettings,
  readLegacyEnvironment,
  resolveSettings,
  reportError
}) {
  let storeExists = true;
  try {
    storeExists = await hasPersistedSettings();
  } catch (error) {
    reportError(error instanceof Error ? error.message : "Failed to inspect service settings");
  }
  let migrationPending = platform === "win32" && !storeExists;
  let legacyEnvironment = {};

  if (migrationPending) {
    try {
      legacyEnvironment = await readLegacyEnvironment();
    } catch (error) {
      reportError(error instanceof Error ? error.message : "Failed to read legacy settings");
    }
  }

  return {
    async read() {
      const stored = await readStoredSettings();
      return migrationPending ? resolveSettings(stored, legacyEnvironment) : stored;
    },

    async write(settings) {
      const written = await writeStoredSettings(settings);
      migrationPending = false;
      legacyEnvironment = {};
      return written;
    }
  };
}

module.exports = { createServiceSettingsMigration };
