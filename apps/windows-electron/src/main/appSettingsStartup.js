async function readInitialAppSettings({ read, defaults, reportError }) {
  try {
    return await read();
  } catch (error) {
    reportError(error instanceof Error ? error.message : "Failed to load app settings");
    return { ...defaults };
  }
}

module.exports = { readInitialAppSettings };
