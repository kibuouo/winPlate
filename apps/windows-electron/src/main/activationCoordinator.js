const MAIN_SECTIONS = new Set([
  "Dashboard", "GitHub", "Codex", "Heart", "QWeather", "Notifications", "Settings"
]);

function normalizeMainSection(section) {
  return typeof section === "string" && MAIN_SECTIONS.has(section)
    ? section
    : "Dashboard";
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
