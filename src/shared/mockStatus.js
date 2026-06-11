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
    status: "Normal"
  },
  heart: {
    heartRate: 82,
    unit: "bpm",
    source: "Apple Watch",
    updatedAt: "just now"
  }
};

if (typeof module !== "undefined") {
  module.exports = { mockStatus };
}
