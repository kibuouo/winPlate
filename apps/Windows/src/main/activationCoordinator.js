const MAIN_SECTIONS = new Set([
  "Dashboard", "GitHub", "Agent", "Heart", "Mail", "QWeather", "Notifications", "Settings"
]);

function normalizeMainSection(section) {
  if (typeof section !== "string") return "Dashboard";
  // Backward-compat: older deep links used the Codex section name.
  if (section === "Codex") return "Agent";
  return MAIN_SECTIONS.has(section) ? section : "Dashboard";
}

function createActivationCoordinator(showMainWindow) {
  let ready = false;
  let pendingSection = null;

  function request(section = "Dashboard") {
    const normalizedSection = normalizeMainSection(section);
    if (!ready) {
      pendingSection = normalizedSection;
      return;
    }
    showMainWindow(normalizedSection);
  }

  return {
    request,
    onSecondInstance: () => request("Dashboard"),
    onActivate: () => request("Dashboard"),
    markReady() {
      if (ready) return;
      ready = true;
      if (pendingSection) {
        const section = pendingSection;
        pendingSection = null;
        showMainWindow(section);
      }
    }
  };
}

module.exports = { createActivationCoordinator, normalizeMainSection };
