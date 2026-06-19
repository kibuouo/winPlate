const crypto = require("crypto");

const CACHE_TTL_MS = 5 * 60_000;
const MAX_AI_ITEMS = 5;
const MAX_TEXT_LENGTH = 28;
const RECENT_WINDOW_MS = 24 * 60 * 60_000;
const VALID_LEVELS = new Set(["info", "success", "warning", "critical"]);
const VALID_SOURCES = new Set(["weather", "mail", "codex", "chatgpt", "github", "system", "local"]);
const SECRET_FIELD_RE = /token|api[_-]?key|password|authorization|auth|secret/i;

function clampText(value, limit = MAX_TEXT_LENGTH) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return Array.from(text).slice(0, limit).join("");
}

function normalizeSource(source) {
  const value = String(source || "").toLowerCase();
  if (value === "qweather" || value === "weather") return "weather";
  if (value === "external") return "local";
  return VALID_SOURCES.has(value) ? value : "local";
}

function normalizeLevel(level) {
  const value = String(level || "info").toLowerCase();
  return VALID_LEVELS.has(value) ? value : "info";
}

function rawNotificationFromItem(item = {}) {
  const source = normalizeSource(item.source);
  const title = String(item.title || item.subject || "").trim();
  const body = String(item.body || item.message || item.summary || "").trim();
  const time = Number(item.time || item.createdAt || item.sentAt || item.updatedAt || Date.now());
  return {
    id: String(item.id || item.uid || `${source}:${time}`).slice(0, 160),
    source,
    title,
    body,
    time: Number.isFinite(time) ? time : Date.now(),
    level: normalizeLevel(item.level),
    unread: Boolean(item.unread),
    sender: source === "mail" ? String(item.sender || item.from || item.message || "").trim() : "",
    subject: source === "mail" ? String(item.subject || title.replace(/^新邮件[:：]\s*/, "")).trim() : "",
    snippet: source === "mail" ? String(item.snippet || item.summary || item.message || "").trim() : "",
    meta: item.meta && typeof item.meta === "object" ? item.meta : undefined
  };
}

function normalizeNotificationSummary(summary = {}) {
  const items = Array.isArray(summary.items) ? summary.items : [];
  return items.map(rawNotificationFromItem).filter((item) => {
    const text = `${item.title} ${item.body} ${item.subject} ${item.snippet}`.trim();
    return item.id && text;
  });
}

function sanitizeObject(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 2) return undefined;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_FIELD_RE.test(key)) continue;
    if (entry === null || entry === undefined) continue;
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      result[key] = typeof entry === "string" ? clampText(entry, 160) : entry;
    } else if (typeof entry === "object") {
      const nested = sanitizeObject(entry, depth + 1);
      if (nested && Object.keys(nested).length) result[key] = nested;
    }
  }
  return result;
}

function sanitizeNotificationForAI(notification) {
  const source = normalizeSource(notification.source);
  const base = {
    id: notification.id,
    source,
    title: clampText(notification.title, 120),
    level: normalizeLevel(notification.level),
    time: notification.time,
    unread: Boolean(notification.unread)
  };
  if (source === "mail") {
    return {
      ...base,
      sender: clampText(notification.sender || notification.body, 80),
      subject: clampText(notification.subject || notification.title.replace(/^新邮件[:：]\s*/, ""), 120),
      snippet: clampText(notification.snippet || notification.body, 160),
      hasAttachment: Boolean(notification.hasAttachment)
    };
  }
  return {
    ...base,
    body: clampText(notification.body, 220),
    meta: sanitizeObject(notification.meta)
  };
}

function scoreNotification(notification, now = Date.now()) {
  let score = 0;
  if (notification.level === "critical") score += 100;
  if (notification.level === "warning") score += 70;
  if (notification.level === "success") score += 30;
  const text = `${notification.title || ""} ${notification.body || ""} ${notification.subject || ""} ${notification.snippet || ""}`;
  if (notification.source === "weather" && /预警|暴雨|雷电|大风|高温|寒潮|冰雹|台风/.test(text)) {
    score += 80;
  }
  if (notification.source === "mail" && notification.unread) {
    score += 30;
  }
  if (notification.source === "codex" && /失败|错误|异常|完成|成功/.test(text)) {
    score += 40;
  }
  if (now - notification.time < 10 * 60 * 1000) {
    score += 20;
  }
  return score;
}

function selectCandidateNotifications(notifications, now = Date.now()) {
  const seen = new Set();
  return notifications
    .filter((item) => now - item.time <= RECENT_WINDOW_MS || item.unread)
    .map((item) => ({ item, score: scoreNotification(item, now) }))
    .filter(({ item, score }) => {
      const key = `${item.source}|${item.title}|${item.body}|${item.sender}|${item.subject}|${item.snippet}`;
      if (seen.has(key) || score <= 0) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score || b.item.time - a.item.time)
    .slice(0, 10)
    .map(({ item }) => item);
}

function computeBriefHash(notifications) {
  const input = notifications.map((item) => [
    item.source,
    item.title,
    item.body,
    item.sender,
    item.subject,
    item.snippet,
    item.level,
    item.time
  ].join("\u001f")).join("\u001e");
  return crypto.createHash("sha256").update(input).digest("hex");
}

function actionTypeForSource(source) {
  return {
    weather: "open_weather",
    mail: "open_mail",
    codex: "open_codex",
    chatgpt: "open_notifications",
    github: "open_github",
    system: "open_notifications",
    local: "open_notifications"
  }[source] || "none";
}

function fallbackText(notification) {
  const text = `${notification.title} ${notification.body} ${notification.subject} ${notification.snippet}`;
  if (notification.source === "weather" && /暴雨/.test(text)) return "暴雨预警：注意出行";
  if (notification.source === "weather" && /预警/.test(text)) return "天气预警：注意出行";
  if (notification.source === "mail") {
    const sender = notification.sender || notification.body || "有人";
    return `新邮件：${sender} 发来消息`;
  }
  if (notification.source === "codex" && /完成|成功/.test(text)) return "Codex：任务已完成";
  if (notification.source === "codex" && /失败|错误|异常/.test(text)) return "Codex：任务出现错误";
  if (notification.source === "chatgpt" && /完成|成功/.test(text)) return "ChatGPT：任务已完成";
  return notification.title || notification.body || "WinPlate 收到新通知";
}

function fallbackBrief(notifications, now = Date.now()) {
  return notifications.slice(0, MAX_AI_ITEMS).map((item) => ({
    id: `brief-${item.id}`,
    sourceIds: [item.id],
    text: clampText(fallbackText(item)),
    level: normalizeLevel(item.level),
    source: normalizeSource(item.source),
    actionType: actionTypeForSource(item.source),
    generatedAt: now
  }));
}

function buildSmartBriefPrompt(notifications) {
  const system = [
    "你是 WinPlate 的桌面通知压缩引擎。",
    "你的任务是把多条通知整理成适合顶部桌面胶囊显示的一行短文案。",
    "你必须只输出 JSON，不要输出 Markdown，不要输出解释。",
    "顶层 JSON 必须是对象，格式为 {\"items\":[...]}。",
    "每个 item 只能包含 id、sourceIds、text、level、source、actionType。",
    "要求：",
    "1. 每条 text 不超过 28 个中文字符。",
    "2. 保留最重要的信息。",
    "3. 优先处理天气预警、失败、错误、重要邮件、任务完成。",
    "4. 不要编造通知中不存在的信息。",
    "5. 邮件只能根据 sender、subject、snippet 判断，不要臆测邮件正文。",
    "6. 相同或重复通知要合并。",
    "7. 输出 1 到 5 条 items。",
    "8. 中文表达要短、直接、适合桌面状态栏。",
    "9. 不要使用夸张语气。",
    "10. 不要出现“根据通知”“AI总结”等字样。"
  ].join("\n");
  const user = JSON.stringify({
    locale: "zh-CN",
    maxItems: MAX_AI_ITEMS,
    maxTextLength: MAX_TEXT_LENGTH,
    notifications: notifications.map(sanitizeNotificationForAI)
  });
  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("响应为空");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("JSON 解析失败");
    return JSON.parse(match[0]);
  }
}

function parseSmartBriefResponse(text, candidates, now = Date.now()) {
  const payload = extractJson(text);
  const rawItems = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.brief?.items)
        ? payload.brief.items
        : Array.isArray(payload?.data?.items)
          ? payload.data.items
          : null;
  if (!rawItems) {
    throw new Error("SmartBrief items 结构错误");
  }
  const candidateIds = new Set(candidates.map((item) => item.id));
  return rawItems.slice(0, MAX_AI_ITEMS).map((item, index) => {
    const source = normalizeSource(item?.source);
    const sourceIds = Array.isArray(item?.sourceIds)
      ? item.sourceIds.map(String).filter((id) => candidateIds.has(id))
      : [];
    const textValue = clampText(item?.text);
    if (!textValue) return null;
    return {
      id: String(item?.id || `brief-${index}-${sourceIds[0] || now}`).slice(0, 160),
      sourceIds,
      text: textValue,
      level: normalizeLevel(item?.level),
      source,
      actionType: typeof item?.actionType === "string" ? item.actionType : actionTypeForSource(source),
      generatedAt: now
    };
  }).filter(Boolean);
}

async function generateSmartBrief(notifications, callChat, now = Date.now()) {
  if (!notifications.length) return [];
  const content = await callChat({
    messages: buildSmartBriefPrompt(notifications),
    responseFormat: "json",
    temperature: 0.2,
    feature: "smartBrief",
    maxTokens: 500,
    timeoutMs: 6_000
  });
  const parsed = parseSmartBriefResponse(content, notifications, now);
  if (!parsed.length) throw new Error("SmartBrief 为空");
  return parsed;
}

function createSmartBriefService({ readNotifications, callChat, now = () => Date.now() }) {
  let cache = null;
  let pending = null;

  async function refreshBrief({ force = false } = {}) {
    if (pending && !force) return pending;
    pending = (async () => {
      const currentTime = now();
      const summary = await readNotifications();
      const rawNotifications = normalizeNotificationSummary(summary);
      const candidates = selectCandidateNotifications(rawNotifications, currentTime);
      if (!candidates.length) {
        cache = { hash: "", items: [], generatedAt: currentTime };
        return { items: [], generatedAt: currentTime, source: "empty" };
      }
      const hash = computeBriefHash(candidates);
      if (!force && cache?.hash === hash) {
        return { items: cache.items, generatedAt: cache.generatedAt, source: "cache-hit" };
      }
      if (!force && cache?.items?.length && currentTime - cache.generatedAt < CACHE_TTL_MS) {
        return { items: cache.items, generatedAt: cache.generatedAt, source: "cache-ttl" };
      }
      try {
        const items = await generateSmartBrief(candidates, callChat, currentTime);
        cache = { hash, items, generatedAt: currentTime };
        console.info("smart brief generated");
        return { items, generatedAt: currentTime, source: "deepseek" };
      } catch (error) {
        console.warn("smart brief fallback:", error.code || error.message);
        if (cache?.items?.length) {
          return { items: cache.items, generatedAt: cache.generatedAt, source: "cache-after-failure" };
        }
        const items = fallbackBrief(candidates, currentTime);
        cache = { hash, items, generatedAt: currentTime };
        return { items, generatedAt: currentTime, source: "fallback" };
      }
    })().finally(() => {
      pending = null;
    });
    return pending;
  }

  return {
    getCurrentBrief: () => refreshBrief({ force: false }),
    refreshBrief,
    generateSmartBrief: (notifications) => generateSmartBrief(notifications, callChat, now())
  };
}

module.exports = {
  CACHE_TTL_MS,
  MAX_TEXT_LENGTH,
  buildSmartBriefPrompt,
  clampText,
  computeBriefHash,
  createSmartBriefService,
  fallbackBrief,
  generateSmartBrief,
  normalizeNotificationSummary,
  parseSmartBriefResponse,
  sanitizeNotificationForAI,
  scoreNotification,
  selectCandidateNotifications
};
