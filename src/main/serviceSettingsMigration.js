async function createServiceSettingsMigration({
  platform,
  hasPersistedSettings,
  readStoredSettings,
  writeStoredSettings,
  readLegacyEnvironment,
  resolveSettings,
  reportError
}) {
  const storeExists = await hasPersistedSettings();
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
