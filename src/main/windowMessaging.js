const PENDING_SENDS = Symbol("pendingDidFinishLoadSends");
const LOAD_DISPATCH_BOUND = Symbol("didFinishLoadDispatchBound");

function canSendToWindow(targetWindow) {
  return Boolean(
    targetWindow
    && !targetWindow.isDestroyed?.()
    && targetWindow.webContents
    && !targetWindow.webContents.isDestroyed?.()
  );
}

function monitorDidFinishLoadListeners(targetWindow, reason = "unknown") {
  if (!canSendToWindow(targetWindow)) {
    return 0;
  }

  const count = targetWindow.webContents.listenerCount("did-finish-load");
  if (count > 1) {
    console.warn(
      `[windowMessaging] did-finish-load listener count=${count} on window`
      + ` "${targetWindow.getTitle?.() || "untitled"}" during ${reason}`
    );
  }
  return count;
}

function flushPendingSends(targetWindow) {
  if (!canSendToWindow(targetWindow)) {
    return;
  }

  const pendingSends = targetWindow[PENDING_SENDS];
  targetWindow[LOAD_DISPATCH_BOUND] = false;
  targetWindow[PENDING_SENDS] = new Map();

  for (const { channel, payload } of pendingSends.values()) {
    if (!canSendToWindow(targetWindow)) {
      return;
    }
    targetWindow.webContents.send(channel, payload);
  }
}

function sendToWindow(targetWindow, channel, payload) {
  if (!canSendToWindow(targetWindow)) {
    return false;
  }

  if (!targetWindow.webContents.isLoading()) {
    targetWindow.webContents.send(channel, payload);
    return true;
  }

  if (!targetWindow[PENDING_SENDS]) {
    targetWindow[PENDING_SENDS] = new Map();
  }
  targetWindow[PENDING_SENDS].set(channel, { channel, payload });

  if (!targetWindow[LOAD_DISPATCH_BOUND]) {
    targetWindow[LOAD_DISPATCH_BOUND] = true;
    targetWindow.webContents.once("did-finish-load", () => flushPendingSends(targetWindow));
  }

  monitorDidFinishLoadListeners(targetWindow, `sendToWindow:${channel}`);
  return true;
}

module.exports = {
  monitorDidFinishLoadListeners,
  sendToWindow
};
