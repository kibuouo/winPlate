const DEFAULT_PANEL_SIZE = Object.freeze({ width: 320, height: 420 });
const PANEL_INSET = 8;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function validateRectangle(rectangle, name) {
  for (const field of ["x", "y", "width", "height"]) {
    const value = rectangle?.[field];

    if (!Number.isFinite(value)) {
      throw new TypeError(`${name}.${field} must be a finite number`);
    }

    if ((field === "width" || field === "height") && value < 0) {
      throw new TypeError(`${name}.${field} must be non-negative`);
    }
  }
}

function formatTemperatureTitle(value) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    (typeof value !== "number" && typeof value !== "string")
  ) {
    return "--°";
  }

  const temperature = Number(value);

  if (!Number.isFinite(temperature)) {
    return "--°";
  }

  return `${clamp(Math.round(temperature), -99, 99)}°C`;
}

function getMenuBarPanelBounds(trayBounds, workArea) {
  validateRectangle(trayBounds, "trayBounds");
  validateRectangle(workArea, "workArea");

  const horizontalInset = Math.min(PANEL_INSET, Math.floor(workArea.width / 2));
  const verticalInset = Math.min(PANEL_INSET, Math.floor(workArea.height / 2));
  const width = Math.max(
    0,
    Math.min(DEFAULT_PANEL_SIZE.width, workArea.width - horizontalInset * 2)
  );
  const minimumX = workArea.x + horizontalInset;
  const maximumX = workArea.x + workArea.width - width - horizontalInset;
  const centeredX = Math.round(trayBounds.x + (trayBounds.width - width) / 2);
  const height = Math.max(
    0,
    Math.min(DEFAULT_PANEL_SIZE.height, workArea.height - verticalInset * 2)
  );
  const minimumY = workArea.y + verticalInset;
  const maximumY = workArea.y + workArea.height - height - verticalInset;
  const belowTrayY = trayBounds.y + trayBounds.height + verticalInset;

  return {
    x: clamp(centeredX, minimumX, maximumX),
    y: clamp(belowTrayY, minimumY, maximumY),
    width,
    height
  };
}

module.exports = {
  DEFAULT_PANEL_SIZE,
  PANEL_INSET,
  formatTemperatureTitle,
  getMenuBarPanelBounds
};
