const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");

module.exports = Object.freeze({
  preloadPath: path.join(packageRoot, "src", "preload", "menuBarPreload.js"),
  rendererPath: path.join(packageRoot, "src", "renderer", "menubar.html")
});
