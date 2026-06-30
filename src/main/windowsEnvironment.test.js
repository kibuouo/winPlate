const assert = require("node:assert/strict");
const test = require("node:test");

const { resolveServiceSettings } = require("./serviceSettings");
const windowsEnvironment = require("./windowsEnvironment");
const EXPECTED_NAMES = [
  "QWEATHER_API_KEY",
  "QWEATHER_API_HOST",
  "QWEATHER_PROJECT_ID",
  "QWEATHER_CREDENTIAL_ID",
  "QWEATHER_PRIVATE_KEY",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL"
];

function requireApi() {
  assert.equal(
    typeof windowsEnvironment.readWindowsServiceEnvironment,
    "function",
    "Windows environment reader must exist"
  );
  assert.equal(typeof windowsEnvironment.composeServiceEnvironment, "function");
  assert.equal(typeof windowsEnvironment.loadExternalServiceEnvironment, "function");
}

test("reads the exact seven legacy registry values", async () => {
  requireApi();
  const calls = [];
  const result = await windowsEnvironment.readWindowsServiceEnvironment(
    async (executable, args, options) => {
      calls.push([executable, [...args], options]);
      const name = args.at(-1);
      return {
        stdout: `\r\n    ${name}    REG_SZ    value-${name}\r\n`
      };
    }
  );

  assert.deepEqual(Object.keys(result), EXPECTED_NAMES);
  assert.deepEqual(result, Object.fromEntries(
    EXPECTED_NAMES.map((name) => [name, `value-${name}`])
  ));
  assert.deepEqual(calls, EXPECTED_NAMES.map((name) => [
    "reg.exe",
    ["query", "HKCU\\Environment", "/v", name],
    { windowsHide: true }
  ]));
});

test("missing registry output and query failures become empty values", async () => {
  requireApi();
  let calls = 0;
  const result = await windowsEnvironment.readWindowsServiceEnvironment(async () => {
    calls += 1;
    if (calls % 2) throw new Error("registry value missing");
    return { stdout: "    UNRELATED    REG_SZ    ignore-me\r\n" };
  });

  assert.equal(calls, EXPECTED_NAMES.length);
  assert.deepEqual(result, Object.fromEntries(EXPECTED_NAMES.map((name) => [name, ""])));
});

test("composed resolution uses process environment before registry before stored", () => {
  requireApi();
  const processEnvironment = {
    QWEATHER_API_KEY: " process-weather ",
    QWEATHER_API_HOST: "",
    DEEPSEEK_BASE_URL: "https://process.deepseek.example"
  };
  const registryEnvironment = {
    QWEATHER_API_KEY: "registry-weather",
    QWEATHER_API_HOST: "registry.weather.example",
    QWEATHER_PROJECT_ID: "registry-project",
    DEEPSEEK_API_KEY: "registry-deepseek"
  };
  const stored = {
    qweatherApiKey: "stored-weather",
    qweatherApiHost: "stored.weather.example",
    qweatherProjectId: "stored-project",
    qweatherCredentialId: "stored-credential",
    qweatherPrivateKey: "stored-private",
    deepseekApiKey: "stored-deepseek",
    deepseekBaseUrl: "https://stored.deepseek.example"
  };

  const composed = windowsEnvironment.composeServiceEnvironment(
    processEnvironment,
    registryEnvironment
  );

  assert.deepEqual(resolveServiceSettings(stored, composed), {
    qweatherApiKey: "process-weather",
    qweatherApiHost: "registry.weather.example",
    qweatherProjectId: "registry-project",
    qweatherCredentialId: "stored-credential",
    qweatherPrivateKey: "stored-private",
    deepseekApiKey: "registry-deepseek",
    deepseekBaseUrl: "https://process.deepseek.example"
  });
  assert.deepEqual(processEnvironment, {
    QWEATHER_API_KEY: " process-weather ",
    QWEATHER_API_HOST: "",
    DEEPSEEK_BASE_URL: "https://process.deepseek.example"
  });
});

test("non-Windows startup never reads the registry fallback", async () => {
  requireApi();
  let reads = 0;

  const result = await windowsEnvironment.loadExternalServiceEnvironment({
    platform: "darwin",
    processEnvironment: { QWEATHER_API_KEY: "inherited" },
    readLegacyEnvironment: async () => {
      reads += 1;
      throw new Error("must not run");
    }
  });

  assert.equal(reads, 0);
  assert.equal(result.QWEATHER_API_KEY, "inherited");
});
