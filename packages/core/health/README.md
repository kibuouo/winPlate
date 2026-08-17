Heart-rate history rules live here so Windows main and renderer share one
normalize/merge/window/stats/CSV implementation.

Keep this module free of Electron, filesystem, and platform UI. Persistence,
the LAN listener, and the SVG chart stay in `apps/Windows`.
