const test = require("node:test");
const assert = require("node:assert/strict");
const { callDeepSeekChat, testDeepSeekChat } = require("./deepseekChatClient");

test("calls DeepSeek chat completions without exposing the API key in URL or body", async () => {
  let request;
  const content = await callDeepSeekChat({
    apiKey: "secret-key",
    baseUrl: "https://example.test/",
    messages: [{ role: "user", content: "hello" }],
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ok" } }] })
      };
    }
  });

  assert.equal(content, "ok");
  assert.equal(request.url, "https://example.test/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer secret-key");
  assert.doesNotMatch(request.url, /secret-key/);
  assert.doesNotMatch(request.options.body, /secret-key/);
});

test("reports token usage from successful chat responses", async () => {
  let reportedUsage;
  const content = await callDeepSeekChat({
    apiKey: "secret-key",
    messages: [{ role: "user", content: "hello" }],
    onUsage: async (usage) => {
      reportedUsage = usage;
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
        usage: {
          prompt_tokens: 11,
          completion_tokens: 7,
          total_tokens: 18,
          prompt_cache_hit_tokens: 3,
          prompt_cache_miss_tokens: 8
        }
      })
    })
  });

  assert.equal(content, "ok");
  assert.deepEqual(reportedUsage, {
    prompt_tokens: 11,
    completion_tokens: 7,
    total_tokens: 18,
    prompt_cache_hit_tokens: 3,
    prompt_cache_miss_tokens: 8
  });
});

test("testDeepSeekChat accepts the expected minimal response", async () => {
  const result = await testDeepSeekChat({
    apiKey: "secret-key",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "AI 调用正常" } }] })
    })
  });

  assert.deepEqual(result, { ok: true, message: "AI 调用正常" });
});

test("missing API key is normalized before issuing a network request", async () => {
  let called = false;
  await assert.rejects(
    () => callDeepSeekChat({
      messages: [{ role: "user", content: "hello" }],
      fetchImpl: async () => {
        called = true;
      }
    }),
    { code: "api_key_missing" }
  );
  assert.equal(called, false);
});
