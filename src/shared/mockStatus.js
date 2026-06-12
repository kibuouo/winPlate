const mockStatus = {
  github: {
    source: "loading",
    name: "GitHub",
    username: "@loading",
    profileUrl: "https://github.com",
    avatarUrl: "",
    repos: 0,
    followers: 0,
    project: "Loading...",
    commitsThisMonth: 0,
    streakDays: 0,
    status: "Loading",
    language: "Unknown",
    stars: 0,
    updatedText: "",
    contributions30d: Array(30).fill(0),
    contributionMonths: []
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
