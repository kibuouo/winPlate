const mockStatus = {
  github: {
    name: "kibuouo",
    username: "@kibuouo",
    repos: 24,
    followers: 18,
    project: "winplate"
  },
  codex: {
    source: "mock",
    remainingPct: 69,
    usedPct: 31,
    resetText: "15:23",
    updatedAt: Date.now(),
    windowHours: 5,
    status: "Normal",
    windows: {
      fiveHour: { remainingPct: 69, usedPct: 31, resetText: "1h 27m" },
      sevenDay: { remainingPct: 84, usedPct: 16, resetText: "6d 20h" }
    }
  },
  heart: {
    heartRate: 82,
    unit: "bpm",
    source: "Apple Watch",
    updatedAt: "just now"
  },
  weather: {
    icon: "🌤",
    temperature: 29,
    condition: "多云",
    location: "Singapore"
  }
};

if (typeof module !== "undefined") {
  module.exports = { mockStatus };
}
