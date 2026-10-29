import assert from "node:assert/strict";
import test from "node:test";
import { Recovery } from "../web/recovery.js";
import { Loading } from "../web/loading.js";
import { campaignFile, SAVE_FIELDS } from "../web/campaign-save.js";

function environment(kind = "campaign") {
  const nodes = new Map();
  globalThis.document = Object.assign(new EventTarget(), {
    hidden: false,
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, Object.assign(new EventTarget(), {
        hidden: true, textContent: "", focus() { document.activeElement = this; },
        click() { this.dispatchEvent(new Event("click")); },
      }));
      return nodes.get(id);
    },
  });
  globalThis.window = new EventTarget();
  const messages = [];
  const page = { screen: "battle", battle: { you: "british", kind },
    send(message) { messages.push(message); return true; },
    field: { panels: { menu: null, openMenu() {} }, cancelInput() {} },
  };
  let attempts = 0;
  const recovery = new Recovery(page, () => { attempts++; });
  return { page, messages, recovery, nodes, attempts: () => attempts };
}

test("backgrounding asks the server to pause a solo battle and resume is explicit", () => {
  const { recovery, messages } = environment();
  document.hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  assert.deepEqual(messages, [{ pause: true }]);
  assert.equal(recovery.kind, "resume");
  recovery.primary.click();
  assert.deepEqual(messages, [{ pause: true }, { pause: false }]);
  assert.equal(recovery.kind, null);
});

test("returning to versus never sends a pause or replayed order", () => {
  const { recovery, messages } = environment("versus");
  recovery.interrupted();
  recovery.primary.click();
  assert.deepEqual(messages, []);
  assert.equal(recovery.kind, null);
});

test("resume leaves an already-open pause menu in control", () => {
  const { page, recovery, messages } = environment();
  page.field.panels.menu = {};
  recovery.interrupted();
  recovery.primary.click();
  assert.deepEqual(messages, [{ pause: true }]);
});

test("failed resume keeps recovery visible and offers one manual reconnect", () => {
  const { page, recovery, attempts } = environment();
  page.send = () => false;
  recovery.interrupted();
  recovery.primary.click();
  assert.equal(recovery.kind, "connection");
  recovery.primary.click();
  assert.equal(attempts(), 1);
});

test("graphics recovery remains visible when the connection changes", () => {
  const { recovery } = environment();
  recovery.show("graphics");
  recovery.show("connection");
  recovery.connected();
  assert.equal(recovery.kind, "graphics");
  assert.equal(recovery.box.hidden, false);
});

test("loading failures wait for Retry and then complete the same operation", async () => {
  environment();
  let attempts = 0;
  let failures = 0;
  const loading = new Loading(() => { failures++; });
  const pending = loading.run(async progress => {
    progress(1, 2);
    if (++attempts === 1) throw new Error("network interrupted");
    progress(2, 2);
    return "ready";
  });
  await new Promise(setImmediate);
  assert.equal(attempts, 1);
  assert.equal(failures, 1);
  assert.equal(loading.retry.hidden, false);
  loading.retry.click();
  assert.equal(await pending, "ready");
  assert.equal(attempts, 2);
  assert.equal(loading.box.hidden, true);
});

test("portable files contain durable campaign fields only", () => {
  const save = Object.fromEntries(SAVE_FIELDS.map(key => [key, null]));
  const file = campaignFile({ ...save, open: [1], next: 200, profile: "private" });
  assert.equal(file.format, "warfare1944.campaign");
  assert.equal(file.version, 1);
  assert.deepEqual(file.campaign, save);
});
