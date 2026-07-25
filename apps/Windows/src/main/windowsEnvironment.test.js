const assert = require("node:assert/strict");
const test = require("node:test");

const windowsEnvironment = require("./windowsEnvironment");
const EXPECTED_NAMES = [
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
];

function requireApi() {
  assert.equal(
    typeof windowsEnvironment.readWindowsServiceEnvironment,
    "function",
    "Windows environment reader must exist"
  );
}

test("reads the exact legacy registry values for service settings migration", async () => {
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
