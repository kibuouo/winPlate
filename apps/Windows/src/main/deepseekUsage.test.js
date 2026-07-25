const test = require("node:test");
const assert = require("node:assert/strict");
const {
  fetchDeepSeekUsage,
  normalizeBaseUrl,
  parseDeepSeekBalance
} = require("./deepseekUsage");

test("maps DeepSeek balance response without converting money to a fake quota", () => {
  const usage = parseDeepSeekBalance({
    is_available: true,
    balance_infos: [{
      currency: "CNY",
      total_balance: "110.00",
      granted_balance: "10.00",
      topped_up_balance: "100.00"
    }]
  }, 123);

  assert.equal(usage.available, true);
  assert.equal(usage.balances[0].totalBalance, "110.00");
  assert.equal(usage.balances[0].grantedBalance, "10.00");
  assert.equal(usage.balances[0].toppedUpBalance, "100.00");
  assert.equal(usage.tokenUsage, null);
  assert.equal(usage.updatedAt, 123);
  assert.equal(usage.status, "Normal");
});

test("normalizes a configurable DeepSeek base URL", () => {
  assert.equal(normalizeBaseUrl("https://api.deepseek.com///"), "https://api.deepseek.com");
});

test("does not issue a request when the API key is missing", async () => {
  let called = false;
  const usage = await fetchDeepSeekUsage({
    fetchImpl: async () => {
      called = true;
    }
  });
  assert.equal(called, false);
  assert.equal(usage.status, "Unconfigured");
});

test("sends the API key only in the authorization header", async () => {
  let request;
  const usage = await fetchDeepSeekUsage({
    apiKey: "secret-key",
    baseUrl: "https://example.test/",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ is_available: false, balance_infos: [] })
      };
    }
  });
  assert.equal(request.url, "https://example.test/user/balance");
  assert.equal(request.options.headers.Authorization, "Bearer secret-key");
  assert.equal(usage.status, "Unavailable");
});
