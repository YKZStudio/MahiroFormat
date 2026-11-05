const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createOfficeReadiness, OfficePreparationError } = require("../src/office-readiness");

test("non-Store startup is ready without preparing any engine", async () => {
  const state = createOfficeReadiness();
  assert.equal(state.getOfficeState().status, "ready");
  assert.equal((await state.waitForOfficeReady()).status, "ready");
});

test("Office work waits for preparation while other work remains responsive", async () => {
  const state = createOfficeReadiness();
  let finish;
  let calls = 0;
  state.configureOfficePreparation({ path: "writable/soffice.com", prepare: () => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  } });
  let converted = false;
  const conversion = state.waitForOfficeReady().then(() => { converted = true; });
  assert.equal(state.getOfficeState().status, "pending");
  assert.equal(calls, 0, "configuration must not copy engines before window creation");
  void state.startOfficePreparation();
  void state.startOfficePreparation();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(converted, false);
  assert.equal(calls, 1, "simultaneous callers must share preparation");
  finish({ source: "published", path: "writable/soffice.com" });
  await conversion;
  assert.equal(state.getOfficeState().status, "ready");
});

for (const [name, prepare] of [
  ["worker failure", async () => { throw new Error("ENOSPC"); }],
  ["read-only fallback", async () => ({ source: "bundled", path: "readonly/soffice.com", reason: "access denied" })],
  ["unexpected destination", async () => ({ source: "cache", path: "wrong/soffice.com" })]
]) {
  test(`${name} is retained as actionable Office-only failure`, async () => {
    const state = createOfficeReadiness();
    state.configureOfficePreparation({ path: "writable/soffice.com", prepare });
    await state.startOfficePreparation();
    const current = state.getOfficeState();
    assert.equal(current.status, "failed");
    assert.ok(current.error instanceof OfficePreparationError);
    assert.equal(current.error.code, "OFFICE_ENGINE_PREPARATION_FAILED");
    assert.ok(current.error.messages.enUS);
    assert.ok(current.error.messages.zhCN);
    await assert.rejects(state.waitForOfficeReady(), (error) => error === current.error);
  });
}
