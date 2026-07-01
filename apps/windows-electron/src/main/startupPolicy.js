function startupPolicy(platform = process.platform) {
  if (platform === "darwin") {
    return {
      createWindowsTray: false,
      createMacMenuBar: true,
      createFloatingWindow: false
    };
  }

  return {
    createWindowsTray: platform === "win32",
    createMacMenuBar: false,
    createFloatingWindow: platform === "win32"
  };
}

module.exports = { startupPolicy };
