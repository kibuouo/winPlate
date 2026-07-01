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
  let legacyReadSucceeded = false;
  let operationQueue = Promise.resolve();
  let sharedRead = null;

  if (migrationPending) {
    try {
      legacyEnvironment = await readLegacyEnvironment();
      legacyReadSucceeded = true;
    } catch (error) {
      reportError(error instanceof Error ? error.message : "Failed to read legacy settings");
    }
  }

  function enqueue(operation) {
    const result = operationQueue.then(operation);
    operationQueue = result.catch(() => undefined);
    return result;
  }

  function completeMigration() {
    migrationPending = false;
    legacyReadSucceeded = false;
    legacyEnvironment = {};
  }

  return {
    read() {
      if (sharedRead) return sharedRead;
      const operation = enqueue(async () => {
        const stored = await readStoredSettings();
        if (!migrationPending || !legacyReadSucceeded) return stored;

        const migrated = resolveSettings(stored, legacyEnvironment);
        try {
          const written = await writeStoredSettings(migrated);
          completeMigration();
          return written;
        } catch (error) {
          reportError(error instanceof Error ? error.message : "Failed to migrate service settings");
          return migrated;
        }
      });
      sharedRead = operation;
      const clearSharedRead = () => {
        if (sharedRead === operation) sharedRead = null;
      };
      operation.then(clearSharedRead, clearSharedRead);
      return operation;
    },

    write(settings) {
      return enqueue(async () => {
        const written = await writeStoredSettings(settings);
        completeMigration();
        return written;
      });
    }
  };
}

module.exports = { createServiceSettingsMigration };
