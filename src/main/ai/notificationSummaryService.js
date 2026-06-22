const { createLocalDigest, digestHash } = require("../notifications/digestEngine");
const {
  ICON_KEYS,
  normalizeSmartNotificationIconKey
} = require("../../shared/smartNotificationIconKeys");

const VALID_SEVERITIES = new Set(["info", "warning", "danger"]);

function clamp(value, limit) {
  return Array.from(String(value || "").replace(/\s+/g, " ").trim()).slice(0, limit).join("");
}

function buildSummaryPrompt(items, localDigest) {
  return [
    {
      role: "system",
      content: [
        "你是 WinPlate Notification Digest 引擎。",
        "必须只返回一个 JSON 对象，不得返回 Markdown 或自由文本。",
        "JSON 必须严格包含 title、summary、severity、category、iconKey、unreadCount 六个字段。",
        "title 不超过 28 个中文字符；summary 不超过 160 个中文字符。",
        "severity 只能原样返回 localDigest.severity，不得自行升降级。",
        "iconKey 只能从提供的白名单中选择，禁止返回 SVG、HTML 或其他图形代码。",
        "天气解除或取消表示风险降低，不得描述为正在发生的高危警报。",
        "不得编造输入中不存在的事实。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        schema: {
          title: "string",
          summary: "string",
          severity: "danger | warning | info",
          category: "string",
          iconKey: "whitelisted string",
          unreadCount: "number"
        },
        allowedIconKeys: ICON_KEYS,
        localDigest,
        notifications: items.slice(0, 12).map((item) => ({
          id: item.id,
          source: item.source,
          type: item.type,
          title: clamp(item.title, 120),
          body: clamp(item.body, item.source === "mail" ? 120 : 220),
          level: item.level,
          unread: item.unread,
          lifecycle: item.meta?.lifecycle,
          riskDelta: item.meta?.riskDelta
        }))
      })
    }
  ];
}

function validateSummaryResult(payload, localDigest) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") throw new Error("Digest JSON 必须是对象");
  const title = clamp(payload.title, 28);
  const summary = clamp(payload.summary, 160);
  const severity = String(payload.severity || "").toLowerCase();
  const category = clamp(payload.category || localDigest.category || "system", 40).toLowerCase();
  const iconKey = normalizeSmartNotificationIconKey(payload.iconKey, "bell");
  const unreadCount = Number(payload.unreadCount);
  if (!title || !summary || !VALID_SEVERITIES.has(severity) || !Number.isFinite(unreadCount) || unreadCount < 0) {
    throw new Error("Digest JSON 字段无效");
  }
  return {
    ...localDigest,
    title,
    headline: title,
    summary,
    severity: localDigest.severity,
    category,
    iconKey,
    unreadCount: localDigest.unreadCount,
    spokenText: `${title}。${summary}`
  };
}

function parseStructuredDigest(content, localDigest) {
  const payload = typeof content === "string" ? JSON.parse(content) : content;
  return validateSummaryResult(payload, localDigest);
}

function createNotificationSummaryService({
  store,
  callChat,
  shouldUseAi = () => true,
  onUpdated = () => {},
  persistDigest = () => Promise.resolve(),
  aiModel = "",
  debounceMs = 1_500,
  now = () => Date.now()
}) {
  if (!store?.collect) throw new TypeError("notification store is required");
  let current = null;
  let currentHash = "";
  let pending = null;
  let timer = null;
  let scheduledResolvers = [];

  async function refreshNow({ force = false } = {}) {
    if (pending) return pending;
    pending = (async () => {
      const snapshot = await store.collect();
      const hash = digestHash(snapshot.items);
      const localDigest = createLocalDigest(snapshot.items, now());
      if (!force && current && currentHash === hash) return current;
      let digest = localDigest;
      let source = "local";
      const aiEnabled = snapshot.items.length
        && typeof callChat === "function"
        && await Promise.resolve(shouldUseAi());
      if (aiEnabled) {
        try {
          const content = await callChat({
            messages: buildSummaryPrompt(snapshot.items, localDigest),
            responseFormat: "json",
            temperature: 0.1,
            maxTokens: 420,
            timeoutMs: 7_000,
            feature: "notificationDigest"
          });
          digest = parseStructuredDigest(content, localDigest);
          source = "ai";
        } catch (error) {
          console.warn("notification digest fallback:", error.code || error.message);
        }
      }
      const generatedAt = now();
      currentHash = hash;
      current = { ...digest, generatedAt, source };
      if (source === "ai") {
        try {
          await Promise.resolve(persistDigest({
            digest: current,
            localDigest,
            snapshot,
            model: aiModel
          }));
        } catch (error) {
          console.warn("notification digest persist failed:", error.message || error);
        }
      }
      onUpdated(current);
      return current;
    })().finally(() => {
      pending = null;
    });
    return pending;
  }

  function scheduleRefresh() {
    clearTimeout(timer);
    return new Promise((resolve, reject) => {
      scheduledResolvers.push({ resolve, reject });
      timer = setTimeout(async () => {
        const resolvers = scheduledResolvers;
        scheduledResolvers = [];
        timer = null;
        try {
          if (pending) await pending;
          const digest = await refreshNow({ force: true });
          resolvers.forEach(({ resolve: done }) => done(digest));
        } catch (error) {
          resolvers.forEach(({ reject: fail }) => fail(error));
        }
      }, Math.max(0, debounceMs));
    });
  }

  return {
    getDigest: () => current ? Promise.resolve(current) : refreshNow(),
    refreshNow,
    scheduleRefresh
  };
}

module.exports = {
  buildSummaryPrompt,
  createNotificationSummaryService,
  parseStructuredDigest,
  validateSummaryResult
};
