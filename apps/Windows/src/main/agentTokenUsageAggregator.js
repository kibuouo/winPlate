/**
 * Shared hourly/daily bucketing for agent token trend charts (Codex + SuperGrok).
 * Mirrors macOS AgentTokenUsageAggregator.
 */

function unavailableTokenUsage(now = Date.now()) {
  return {
    available: false,
    isAvailable: false,
    hourly: [],
    daily: [],
    totalTokens: 0,
    hourlyTotalTokens: 0,
    updatedAt: now
  };
}

function startOfHour(ms) {
  const date = new Date(ms);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

function startOfDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addHours(ms, count) {
  return ms + count * 60 * 60 * 1000;
}

function addDays(ms, count) {
  const date = new Date(ms);
  date.setDate(date.getDate() + count);
  return date.getTime();
}

function bucketStarts(unit, first, last) {
  const result = [];
  let cursor = first;
  const step = unit === "hour" ? addHours : addDays;
  while (cursor <= last) {
    result.push(cursor);
    const next = step(cursor, 1);
    if (next <= cursor) break;
    cursor = next;
  }
  return result;
}

/**
 * @param {{ date: number|Date, tokens: number }[]} entries
 * @param {number} [now]
 */
function aggregateTokenUsage(entries, now = Date.now()) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      date: entry.date instanceof Date ? entry.date.getTime() : Number(entry.date),
      tokens: Math.max(0, Math.trunc(Number(entry.tokens) || 0))
    }))
    .filter((entry) => Number.isFinite(entry.date));

  if (!normalized.length) return unavailableTokenUsage(now);

  const firstEntryDate = Math.min(...normalized.map((entry) => entry.date));
  const lastEntryDate = Math.max(...normalized.map((entry) => entry.date));
  const lastVisibleDate = Math.max(now, lastEntryDate);
  const firstHour = startOfHour(firstEntryDate);
  const lastHour = startOfHour(lastVisibleDate);
  const firstDay = startOfDay(firstEntryDate);
  const lastDay = startOfDay(lastVisibleDate);
  const hourStarts = bucketStarts("hour", firstHour, lastHour);
  const dayStarts = bucketStarts("day", firstDay, lastDay);
  const hourlyTotals = Object.fromEntries(hourStarts.map((start) => [start, 0]));
  const dailyTotals = Object.fromEntries(dayStarts.map((start) => [start, 0]));

  for (const entry of normalized) {
    if (entry.date >= firstHour) {
      const hour = startOfHour(entry.date);
      if (Object.prototype.hasOwnProperty.call(hourlyTotals, hour)) {
        hourlyTotals[hour] += entry.tokens;
      }
    }
    if (entry.date >= firstDay) {
      const day = startOfDay(entry.date);
      if (Object.prototype.hasOwnProperty.call(dailyTotals, day)) {
        dailyTotals[day] += entry.tokens;
      }
    }
  }

  const hourly = hourStarts.map((start) => ({ start, tokens: hourlyTotals[start] || 0 }));
  const daily = dayStarts.map((start) => ({ start, tokens: dailyTotals[start] || 0 }));
  const totalTokens = daily.reduce((sum, bucket) => sum + bucket.tokens, 0);
  const hourlyTotalTokens = hourly.reduce((sum, bucket) => sum + bucket.tokens, 0);

  return {
    available: true,
    isAvailable: true,
    hourly,
    daily,
    totalTokens,
    hourlyTotalTokens,
    updatedAt: now
  };
}

module.exports = {
  unavailableTokenUsage,
  aggregateTokenUsage,
  startOfHour,
  startOfDay
};
