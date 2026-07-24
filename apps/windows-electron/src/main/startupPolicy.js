function startupPolicy(platform = process.platform) {
  if (platform !== "win32") {
    throw new Error(`Windows Electron only supports win32; received: ${platform}`);
  }

  return {
    createWindowsTray: true,
    createFloatingWindow: true
  };
}

module.exports = { startupPolicy };
