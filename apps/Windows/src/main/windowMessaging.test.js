const assert = require("node:assert/strict");
const test = require("node:test");
const {
  monitorDidFinishLoadListeners,
  sendToWindow
} = require("./windowMessaging");

function createWindowDouble() {
  const listeners = new Map();
  const sent = [];
  const webContents = {
    loading: true,
    isLoading() {
      return this.loading;
    },
    isDestroyed() {
      return false;
    },
    send(channel, payload) {
      sent.push({ channel, payload });
    },
    once(event, handler) {
      const handlers = listeners.get(event) || [];
      handlers.push(handler);
      listeners.set(event, handlers);
    },
    listenerCount(event) {
      return (listeners.get(event) || []).length;
    },
    emit(event) {
      const handlers = listeners.get(event) || [];
      listeners.set(event, []);
      for (const handler of handlers) {
        handler();
      }
    }
  };

  return {
    __sent: sent,
    webContents,
    isDestroyed() {
      return false;
    },
    getTitle() {
      return "test";
    }
  };
}

test("sendToWindow deduplicates did-finish-load listeners while loading", () => {
  const win = createWindowDouble();

  sendToWindow(win, "tooltip:update", { step: 1 });
  sendToWindow(win, "tooltip:update", { step: 2 });
  sendToWindow(win, "status:refresh", { ok: true });

  assert.equal(monitorDidFinishLoadListeners(win, "test"), 1);
});

test("sendToWindow flushes latest payload per channel after load", () => {
  const win = createWindowDouble();

  sendToWindow(win, "tooltip:update", { step: 1 });
  sendToWindow(win, "tooltip:update", { step: 2 });
  sendToWindow(win, "status:refresh", { ok: true });

  win.webContents.loading = false;
  win.webContents.emit("did-finish-load");

  assert.deepEqual(win.__sent, [
    { channel: "tooltip:update", payload: { step: 2 } },
    { channel: "status:refresh", payload: { ok: true } }
  ]);
  assert.equal(monitorDidFinishLoadListeners(win, "after-flush"), 0);
});

test("sendToWindow sends immediately after load completes", () => {
  const win = createWindowDouble();
  win.webContents.loading = false;

  sendToWindow(win, "main:navigate", "Dashboard");

  assert.deepEqual(win.__sent, [{ channel: "main:navigate", payload: "Dashboard" }]);
});
