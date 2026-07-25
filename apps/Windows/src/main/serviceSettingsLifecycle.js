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
  let persistQueue = Promise.resolve();

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

    persist(patch) {
      const safePatch = { ...safeObject(patch) };
      const operation = persistQueue.then(async () => {
        if (startupLoadFailed) {
          await reload();
        }
        const merged = { ...storedSettings, ...safePatch };
        storedSettings = await write(merged);
        const effective = injectEffectiveEnvironment();
        return publicProjection(effective);
      });
      persistQueue = operation.catch(() => undefined);
      return operation;
    }
  };
}

module.exports = { createServiceSettingsLifecycle, safeObject };
