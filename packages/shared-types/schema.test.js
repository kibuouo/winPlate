const test = require("node:test");
const assert = require("node:assert/strict");

const {
  notificationSchema,
  statusModuleSchema,
  usageSchema,
  schemas
} = require("@winplate/shared-types");

function validateShape(schema, value) {
  const errors = [];
  if (value?.schemaVersion !== schema.properties.schemaVersion.const) {
    errors.push("schemaVersion must match the schema const");
  }
  for (const required of schema.required || []) {
    if (!Object.prototype.hasOwnProperty.call(value || {}, required)) {
      errors.push(`${required} is required`);
    }
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value || {})) {
      if (!schema.properties[key]) errors.push(`${key} is not allowed`);
    }
  }
  return errors;
}

test("exports versioned shared contract schemas", () => {
  assert.equal(schemas.notification, notificationSchema);
  assert.equal(schemas.statusModule, statusModuleSchema);
  assert.equal(schemas.usage, usageSchema);
  assert.equal(notificationSchema.$id, "https://winplate.local/schemas/notification.v1.schema.json");
  assert.equal(statusModuleSchema.$id, "https://winplate.local/schemas/status-module.v1.schema.json");
  assert.equal(usageSchema.$id, "https://winplate.local/schemas/usage.v1.schema.json");
});

test("notification schema accepts current normalized notification shape and rejects missing version", () => {
  const valid = {
    schemaVersion: 1,
    id: "mail:1",
    source: "mail",
    sourceId: "1",
    type: "mail",
    title: "New message",
    body: "Hello",
    level: "info",
    createdAt: 1_718_000_000_000,
    unread: true,
    dedupeKey: "thread-1",
    meta: { threadId: "thread-1" },
    actions: [{
      id: "mail:1:view",
      type: "view",
      label: "查看详情",
      payload: { notificationId: "mail:1" }
    }]
  };

  assert.deepEqual(validateShape(notificationSchema, valid), []);
  const invalid = { ...valid };
  delete invalid.schemaVersion;
  assert.match(validateShape(notificationSchema, invalid).join("\n"), /schemaVersion/);
  assert.match(validateShape(notificationSchema, { ...valid, health: "ok" }).join("\n"), /health is not allowed/);
});

test("status module schema accepts current module metadata and rejects missing version", () => {
  const valid = {
    schemaVersion: 1,
    id: "weather",
    title: "QWeather",
    section: "QWeather",
    views: ["dashboard", "detail", "floating"],
    defaultEnabled: true,
    defaultOrder: 60,
    defaultRefreshSeconds: 600,
    minRefreshSeconds: 60,
    maxRefreshSeconds: 3600,
    configurable: true
  };

  assert.deepEqual(validateShape(statusModuleSchema, valid), []);
  const invalid = { ...valid };
  delete invalid.schemaVersion;
  assert.match(validateShape(statusModuleSchema, invalid).join("\n"), /schemaVersion/);
  assert.match(validateShape(statusModuleSchema, { ...valid, health: "ok" }).join("\n"), /health is not allowed/);
});

test("usage schema accepts compact quota/token usage and rejects missing version", () => {
  const valid = {
    schemaVersion: 1,
    source: "codex-app-server",
    status: "Normal",
    remainingPct: 82,
    usedPct: 18,
    resetText: "4h",
    updatedAt: 1_718_000_000_000,
    windows: {
      fiveHour: { remainingPct: 82, usedPct: 18, resetText: "4h", resetClock: "18:00" },
      sevenDay: { remainingPct: 64, usedPct: 36, resetText: "6d" }
    }
  };

  assert.deepEqual(validateShape(usageSchema, valid), []);
  const invalid = { ...valid };
  delete invalid.schemaVersion;
  assert.match(validateShape(usageSchema, invalid).join("\n"), /schemaVersion/);
  assert.match(validateShape(usageSchema, { ...valid, health: "ok" }).join("\n"), /health is not allowed/);
});
