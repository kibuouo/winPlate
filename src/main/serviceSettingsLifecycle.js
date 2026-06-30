function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function createServiceSettingsLifecycle({
  defaults,
  externalEnvironment,
  targetEnvironment,
  read,
  write,
  resolve,
  publicProjection,
  toEnvironment,
  reportError
}) {
  let storedSettings = { ...defaults };
  let startupLoadFailed = false;

  function effectiveSettings() {
    return resolve(storedSettings, externalEnvironment);
  }

  function injectEffectiveEnvironment() {
    const effective = effectiveSettings();
    Object.assign(targetEnvironment, toEnvironment(effective));
    return effective;
  }

  async function reload() {
    storedSettings = await read();
    startupLoadFailed = false;
  }

  return {
    async loadForStartup() {
      try {
        await reload();
      } catch (error) {
        startupLoadFailed = true;
        reportError(error instanceof Error ? error.message : "Failed to load service settings");
      }
      return injectEffectiveEnvironment();
    },

    effectiveSettings,

    publicSettings() {
      return publicProjection(effectiveSettings());
    },

    async persist(patch) {
      if (startupLoadFailed) {
        await reload();
      }
      const merged = { ...storedSettings, ...safeObject(patch) };
      storedSettings = await write(merged);
      const effective = injectEffectiveEnvironment();
      return publicProjection(effective);
    }
  };
}

module.exports = { createServiceSettingsLifecycle, safeObject };
