const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  EMPTY_PANEL_STATE,
  reducePanelState
} = require("./menuBarModel");

function successfulResults(overrides = {}) {
  return {
    codex: {
      ok: true,
      value: {
        status: "Normal",
        updatedAt: 1_000,
        windows: {
          fiveHour: { remainingPct: 60, resetText: "2h 10m" },
          sevenDay: { remainingPct: 59, resetText: "5d 4h" }
        }
      }
    },
    deepseek: {
      ok: true,
      value: {
        status: "Normal",
        updatedAt: 2_000,
        balances: [
          { currency: "USD", totalBalance: "7.00" },
          { currency: "CNY", totalBalance: "55.55" }
        ]
      }
    },
    status: {
      ok: true,
      value: {
        weather: {
          source: "qweather",
          temperature: "26",
          condition: "多云",
          location: "上海",
          icon: "101",
          updatedAt: 3_000
        }
      }
    },
    ...overrides
  };
}

test("exports the stable empty panel shape", () => {
  assert.deepEqual(EMPTY_PANEL_STATE, {
    codex: {
      active: false,
      status: "Unavailable",
      fiveHour: { remainingPct: null, resetText: "--", updatedAt: null },
      sevenDay: { remainingPct: null, resetText: "--", updatedAt: null },
      updatedAt: null
    },
    deepseek: {
      active: false,
      status: "Unavailable",
      balance: null,
      updatedAt: null
    },
    weather: {
      available: false,
      temperature: null,
      condition: "--",
      location: "--",
      icon: null,
      updatedAt: null
    }
  });
});

test("maps current Codex, DeepSeek, and QWeather data", () => {
  const state = reducePanelState(EMPTY_PANEL_STATE, successfulResults());

  assert.deepEqual(state, {
    codex: {
      active: true,
      status: "Normal",
      fiveHour: { remainingPct: 60, resetText: "2h 10m", updatedAt: 1_000 },
      sevenDay: { remainingPct: 59, resetText: "5d 4h", updatedAt: 1_000 },
      updatedAt: 1_000
    },
    deepseek: {
      active: true,
      status: "Normal",
      balance: "55.55",
      updatedAt: 2_000
    },
    weather: {
      available: true,
      temperature: 26,
      condition: "多云",
      location: "上海",
      icon: "101",
      updatedAt: 3_000
    }
  });
  assert.equal("severity" in state.codex, false);
  assert.equal("warning" in state.codex, false);
});

test("preserves failed sources while successful sources update independently", () => {
  const cached = reducePanelState(EMPTY_PANEL_STATE, successfulResults());
  const state = reducePanelState(cached, {
    codex: { ok: false, error: new Error("codex offline") },
    deepseek: {
      ok: true,
      value: {
        status: "Normal",
        updatedAt: 4_000,
        balances: [{ currency: "CNY", totalBalance: "53.20" }]
      }
    },
    status: { ok: false, error: new Error("status offline") }
  });

  assert.deepEqual(state.codex, {
    ...cached.codex,
    active: false,
    status: "Unavailable"
  });
  assert.deepEqual(state.deepseek, {
    active: true,
    status: "Normal",
    balance: "53.20",
    updatedAt: 4_000
  });
  assert.deepEqual(state.weather, {
    ...cached.weather,
    available: false
  });
});

test("explicit DeepSeek Unconfigured clears cached balance", () => {
  const cached = reducePanelState(EMPTY_PANEL_STATE, successfulResults());
  const state = reducePanelState(cached, {
    deepseek: {
      ok: true,
      value: { status: "Unconfigured", updatedAt: 5_000, balances: [] }
    }
  });

  assert.deepEqual(state.deepseek, {
    active: false,
    status: "Unconfigured",
    balance: null,
    updatedAt: 5_000
  });
});

test("fulfilled DeepSeek Unavailable preserves the last successful balance and timestamp", () => {
  const cached = reducePanelState(EMPTY_PANEL_STATE, successfulResults());
  const unavailableResult = {
    deepseek: {
      ok: true,
      value: {
        status: "Unavailable",
        balances: [],
        updatedAt: 9_000
      }
    }
  };

  assert.deepEqual(reducePanelState(cached, unavailableResult).deepseek, {
    active: false,
    status: "Unavailable",
    balance: "55.55",
    updatedAt: 2_000
  });
  assert.deepEqual(reducePanelState(EMPTY_PANEL_STATE, unavailableResult).deepseek, {
    active: false,
    status: "Unavailable",
    balance: null,
    updatedAt: null
  });
});

test("all source failures from empty retain stable placeholders", () => {
  const failures = {
    codex: { ok: false, error: "no codex" },
    deepseek: { ok: false, error: "no deepseek" },
    status: { ok: false, error: "no status" }
  };

  assert.deepEqual(reducePanelState(EMPTY_PANEL_STATE, failures), EMPTY_PANEL_STATE);
  assert.deepEqual(
    reducePanelState(undefined, failures),
    EMPTY_PANEL_STATE
  );
});

test("parses finite percentages, clamps them, and preserves missing fallbacks", () => {
  const initial = reducePanelState(EMPTY_PANEL_STATE, successfulResults());
  const state = reducePanelState(initial, {
    codex: {
      ok: true,
      value: {
        status: "Normal",
        updatedAt: 6_000,
        windows: {
          fiveHour: { remainingPct: "125", resetText: "soon" },
          sevenDay: { remainingPct: -12, resetText: "later" }
        }
      }
    }
  });

  assert.equal(state.codex.fiveHour.remainingPct, 100);
  assert.equal(state.codex.sevenDay.remainingPct, 0);

  for (const invalid of [null, undefined, "", "  ", "nope", Infinity, -Infinity, NaN]) {
    const next = reducePanelState(initial, {
      codex: {
        ok: true,
        value: {
          status: "Normal",
          updatedAt: 7_000,
          windows: { fiveHour: { remainingPct: invalid } }
        }
      }
    });
    assert.equal(next.codex.fiveHour.remainingPct, 60);
    assert.equal(next.codex.sevenDay.remainingPct, 59);
  }
});

test("explicit nested Codex windows do not fall back to the root percentage", () => {
  const cached = reducePanelState(EMPTY_PANEL_STATE, successfulResults());

  for (const invalid of [null, undefined, "", "nope", Infinity]) {
    const state = reducePanelState(cached, {
      codex: {
        ok: true,
        value: {
          status: "Normal",
          remainingPct: 12,
          updatedAt: 7_500,
          windows: {
            fiveHour: { remainingPct: invalid },
            sevenDay: { remainingPct: invalid }
          }
        }
      }
    });

    assert.equal(state.codex.fiveHour.remainingPct, 60);
    assert.equal(state.codex.sevenDay.remainingPct, 59);
  }
});

test("weather requires qweather and a finite temperature and validates icons", () => {
  const cached = reducePanelState(EMPTY_PANEL_STATE, successfulResults());
  const wrongSource = reducePanelState(cached, {
    status: {
      ok: true,
      value: {
        weather: {
          source: "openweather",
          temperature: 30,
          condition: "晴",
          location: "北京",
          icon: "100",
          updatedAt: 8_000
        }
      }
    }
  });
  assert.deepEqual(wrongSource.weather, { ...cached.weather, available: false });

  for (const invalid of [null, undefined, "", "NaN", Infinity]) {
    const state = reducePanelState(cached, {
      status: {
        ok: true,
        value: {
          weather: { source: "qweather", temperature: invalid, updatedAt: 9_000 }
        }
      }
    });
    assert.deepEqual(state.weather, { ...cached.weather, available: false });
  }

  const invalidIcon = reducePanelState(cached, {
    status: {
      ok: true,
      value: {
        weather: {
          source: "qweather",
          temperature: 27,
          condition: "晴",
          location: "上海",
          icon: "10x",
          updatedAt: 10_000
        }
      }
    }
  });
  assert.equal(invalidIcon.weather.available, true);
  assert.equal(invalidIcon.weather.icon, null);
});

test("reads QWeather from the renderer status result and preserves ISO timestamps", () => {
  const isoTimestamp = "2026-06-29T08:15:30.000Z";
  const state = reducePanelState(EMPTY_PANEL_STATE, {
    status: {
      ok: true,
      value: {
        weather: {
          source: "qweather",
          temperature: "26",
          condition: "多云",
          location: "上海",
          icon: "101",
          updatedAt: isoTimestamp
        }
      }
    }
  });

  assert.deepEqual(state.weather, {
    available: true,
    temperature: 26,
    condition: "多云",
    location: "上海",
    icon: "101",
    updatedAt: isoTimestamp
  });

  for (const invalid of ["", "   ", "not-a-date", Infinity]) {
    const next = reducePanelState(state, {
      status: {
        ok: true,
        value: {
          weather: {
            source: "qweather",
            temperature: 25,
            condition: "晴",
            location: "上海",
            icon: "100",
            updatedAt: invalid
          }
        }
      }
    });
    assert.equal(next.weather.updatedAt, isoTimestamp);
  }
});

test("keeps trimmed DeepSeek CNY formatting and clears invalid balances", () => {
  const formatted = reducePanelState(EMPTY_PANEL_STATE, {
    deepseek: {
      ok: true,
      value: {
        status: "Normal",
        updatedAt: "2026-06-29T08:00:00Z",
        balances: [{ currency: "CNY", totalBalance: " 53.20 " }]
      }
    }
  });
  assert.equal(formatted.deepseek.balance, "53.20");
  assert.equal(formatted.deepseek.updatedAt, "2026-06-29T08:00:00Z");

  for (const balance of [undefined, "", "not-money", "Infinity"]) {
    const state = reducePanelState(formatted, {
      deepseek: {
        ok: true,
        value: {
          status: "Normal",
          updatedAt: 12_000,
          balances: balance === undefined
            ? []
            : [{ currency: "CNY", totalBalance: balance }]
        }
      }
    });
    assert.equal(state.deepseek.balance, null);
  }
});

test("success timestamps replace cached timestamps while failures preserve them", () => {
  const cached = reducePanelState(EMPTY_PANEL_STATE, successfulResults());
  const updated = reducePanelState(cached, successfulResults({
    codex: {
      ok: true,
      value: {
        status: "Normal",
        updatedAt: 11_000,
        windows: {
          fiveHour: { remainingPct: 58 },
          sevenDay: { remainingPct: 57 }
        }
      }
    }
  }));

  assert.equal(updated.codex.updatedAt, 11_000);
  assert.equal(updated.codex.fiveHour.updatedAt, 11_000);
  assert.equal(updated.codex.sevenDay.updatedAt, 11_000);

  const failed = reducePanelState(updated, {
    codex: { ok: false, error: "offline" },
    deepseek: { ok: false, error: "offline" },
    status: { ok: false, error: "offline" }
  });
  assert.equal(failed.codex.updatedAt, 11_000);
  assert.equal(failed.deepseek.updatedAt, 2_000);
  assert.equal(failed.weather.updatedAt, 3_000);
});

test("reducing is pure and returns unaliased nested state", () => {
  const previous = reducePanelState(EMPTY_PANEL_STATE, successfulResults());
  const previousSnapshot = structuredClone(previous);
  const emptySnapshot = structuredClone(EMPTY_PANEL_STATE);
  const result = reducePanelState(previous, {});

  assert.deepEqual(previous, previousSnapshot);
  assert.deepEqual(EMPTY_PANEL_STATE, emptySnapshot);
  assert.notStrictEqual(result, previous);
  assert.notStrictEqual(result.codex, previous.codex);
  assert.notStrictEqual(result.codex.fiveHour, previous.codex.fiveHour);
  assert.notStrictEqual(result.codex.sevenDay, previous.codex.sevenDay);
  assert.notStrictEqual(result.deepseek, previous.deepseek);
  assert.notStrictEqual(result.weather, previous.weather);
});

test("installs the same API on the browser window", () => {
  const filename = path.join(__dirname, "menuBarModel.js");
  const source = fs.readFileSync(filename, "utf8");
  const context = { window: {} };

  vm.runInNewContext(source, context, { filename });

  assert.equal(typeof context.window.WinPlateMenuBarModel.reducePanelState, "function");
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.WinPlateMenuBarModel.EMPTY_PANEL_STATE)),
    EMPTY_PANEL_STATE
  );
});
