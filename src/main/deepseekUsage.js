const DEFAULT_BASE_URL = "https://api.deepseek.com";
const TRACKED_MODEL = "deepseek-v4-pro";
const READ_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60_000;

let cachedUsage = null;
let cachedAt = 0;
let pendingRead = null;

function unavailableUsage(message, configured = false) {
  return {
    source: "deepseek-api",
    configured,
    available: false,
    balances: [],
    tokenUsage: null,
    updatedAt: Date.now(),
    status: configured ? "Unavailable" : "Unconfigured",
    raw: message
  };
}

function parseDeepSeekBalance(payload, now = Date.now()) {
  const balances = Array.isArray(payload?.balance_infos)
    ? payload.balance_infos.map((balance) => ({
        currency: String(balance.currency || ""),
        totalBalance: String(balance.total_balance || "0"),
        grantedBalance: String(balance.granted_balance || "0"),
        toppedUpBalance: String(balance.topped_up_balance || "0")
      })).filter((balance) => balance.currency)
    : [];
  return {
    source: "deepseek-api",
    configured: true,
    available: Boolean(payload?.is_available),
    balances,
    tokenUsage: null,
    updatedAt: now,
    status: balances.length ? (payload.is_available ? "Normal" : "Insufficient") : "Unavailable",
    raw: ""
  };
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
}

async function fetchDeepSeekUsage({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch } = {}) {
  if (!apiKey) return unavailableUsage("DeepSeek API Key is not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/user/balance`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal
    });
    if (!response.ok) {
      return unavailableUsage(`DeepSeek balance request failed: HTTP ${response.status}`, true);
    }
    return parseDeepSeekBalance(await response.json());
  } catch (error) {
    const message = error.name === "AbortError"
      ? "Timed out reading DeepSeek balance"
      : error.message;
    return unavailableUsage(message, true);
  } finally {
    clearTimeout(timer);
  }
}

async function readDeepSeekUsage(options = {}) {
  const { force = false } = options;
  if (!force && cachedUsage && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedUsage;
  }
  if (pendingRead) return pendingRead;
  pendingRead = fetchDeepSeekUsage(options)
    .then((usage) => {
      cachedUsage = usage;
      cachedAt = Date.now();
      return usage;
    })
    .finally(() => {
      pendingRead = null;
    });
  return pendingRead;
}

module.exports = {
  DEFAULT_BASE_URL,
  TRACKED_MODEL,
  fetchDeepSeekUsage,
  normalizeBaseUrl,
  parseDeepSeekBalance,
  readDeepSeekUsage
};
