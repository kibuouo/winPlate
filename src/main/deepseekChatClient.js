const { DEFAULT_BASE_URL, normalizeBaseUrl } = require("./deepseekUsage");

const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_TIMEOUT_MS = 6_000;

class DeepSeekChatError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeepSeekChatError";
    this.code = code;
  }
}

function normalizeChatError(error) {
  if (error instanceof DeepSeekChatError) return error;
  if (error?.name === "AbortError") {
    return new DeepSeekChatError("timeout", "DeepSeek Chat 请求超时");
  }
  return new DeepSeekChatError("network_failed", error?.message || "DeepSeek Chat 网络失败");
}

function httpErrorFromStatus(status, bodyText = "") {
  const lowerBody = String(bodyText || "").toLowerCase();
  if (status === 401 || status === 403) {
    return new DeepSeekChatError("api_key_invalid", "DeepSeek API Key 无效或权限不足");
  }
  if (status === 402 || lowerBody.includes("insufficient") || lowerBody.includes("balance")) {
    return new DeepSeekChatError("insufficient_balance", "DeepSeek 余额不足");
  }
  if (status === 404 || status === 400) {
    return new DeepSeekChatError("model_unavailable", "DeepSeek 模型不可用");
  }
  return new DeepSeekChatError("request_failed", `DeepSeek Chat 请求失败: HTTP ${status}`);
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    throw new DeepSeekChatError("invalid_messages", "DeepSeek Chat messages 不能为空");
  }
  return messages.map((message) => {
    const role = ["system", "user", "assistant"].includes(message?.role) ? message.role : "";
    const content = typeof message?.content === "string" ? message.content : "";
    if (!role || !content.trim()) {
      throw new DeepSeekChatError("invalid_messages", "DeepSeek Chat message 格式无效");
    }
    return { role, content };
  });
}

async function callDeepSeekChat({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  model = DEFAULT_MODEL,
  messages,
  responseFormat = "text",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  temperature = 0.2,
  maxTokens = 256,
  onUsage,
  fetchImpl = fetch
} = {}) {
  if (!apiKey) {
    throw new DeepSeekChatError("api_key_missing", "DeepSeek API Key 未配置");
  }
  const normalizedMessages = normalizeMessages(messages);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  const body = {
    model: String(model || DEFAULT_MODEL),
    messages: normalizedMessages,
    temperature,
    max_tokens: maxTokens
  };
  if (responseFormat === "json") {
    body.response_format = { type: "json_object" };
  }

  try {
    const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw httpErrorFromStatus(response.status, bodyText);
    }
    const payload = await response.json().catch(() => {
      throw new DeepSeekChatError("invalid_response", "DeepSeek Chat 返回了无效 JSON");
    });
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new DeepSeekChatError("empty_response", "DeepSeek Chat 响应为空");
    }
    if (payload?.usage && typeof onUsage === "function") {
      await onUsage(payload.usage);
    }
    return content.trim();
  } catch (error) {
    throw normalizeChatError(error);
  } finally {
    clearTimeout(timer);
  }
}

async function testDeepSeekChat(options = {}) {
  const content = await callDeepSeekChat({
    ...options,
    messages: [
      { role: "system", content: "你是 WinPlate 的 DeepSeek 调用测试。只输出指定文本，不要解释。" },
      { role: "user", content: "请只回复：AI 调用正常" }
    ],
    temperature: 0,
    maxTokens: 16,
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS
  });
  if (!content.includes("AI 调用正常")) {
    throw new DeepSeekChatError("unexpected_response", "DeepSeek AI 调用测试响应不符合预期");
  }
  return { ok: true, message: "AI 调用正常" };
}

module.exports = {
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  DeepSeekChatError,
  callDeepSeekChat,
  testDeepSeekChat
};
