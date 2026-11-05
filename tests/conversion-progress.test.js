"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { EventEmitter } = require("node:events");
const { createProgressRegistry, withConversionProgress, reportConversionProgress,
  captureConversionProgressReporter, createProgressHttpLifecycle } = require("../src/conversion-progress");

function fixture(t, options = {}) {
  let time = 0, wall = 1000;
  const registry = createProgressRegistry({ now: () => wall, monotonicNow: () => time,
    sweepIntervalMs: 0, ...options });
  t.after(() => registry.dispose());
  return { registry, advance(value) { time += value; wall += value; }, setWall(value) { wall = value; } };
}

test("progress reports only measured counters and clears them across unknown stages", t => {
  const { registry, advance, setWall } = fixture(t);
  const id = randomUUID(), scope = registry.create(id);
  assert.equal(registry.get(id).completed, null);
  withConversionProgress(scope, () => {
    assert.equal(reportConversionProgress({ stage: "recognizing", completed: 2, total: 8, unit: "pages", file: "secret.pdf" }), true);
    assert.equal(registry.get(id).completed, 2);
    assert.equal("file" in registry.get(id), false);
    assert.equal(reportConversionProgress({ stage: "converting" }), true);
  });
  advance(123); setWall(-5000);
  assert.equal(registry.get(id).elapsedMs, 123, "wall clock changes must not alter elapsed duration");
  assert.equal(registry.get(id).total, null);
  assert.equal(scope.finish(true), true); advance(50);
  assert.equal(registry.get(id).elapsedMs, 123);
  assert.equal(registry.get(id).status, "succeeded");
  assert.equal(scope.report({ stage: "recognizing" }), false);
  assert.equal(scope.finish(false), false);
});

test("ALS isolates concurrent conversions and explicitly captured late reporters", async t => {
  const { registry } = fixture(t), a = randomUUID(), b = randomUUID();
  const first = registry.create(a), second = registry.create(b);
  let reportFirst;
  await Promise.all([
    withConversionProgress(first, async () => {
      reportFirst = captureConversionProgressReporter();
      await new Promise(resolve => setImmediate(resolve));
      reportConversionProgress({ stage: "recognizing", completed: 1, total: 9, unit: "pages" });
    }),
    withConversionProgress(second, async () => {
      await Promise.resolve();
      reportConversionProgress({ stage: "converting", completed: 0.25, total: 2.75, unit: "seconds" });
    })
  ]);
  assert.equal(registry.get(a).completed, 1); assert.equal(registry.get(b).completed, 0.25);
  assert.equal(reportConversionProgress({ stage: "merging" }), false, "outside a scope is a no-op");
  withConversionProgress(second, () => reportFirst({ stage: "recognizing", completed: 3, total: 9, unit: "pages" }));
  assert.equal(registry.get(a).completed, 3); assert.equal(registry.get(b).completed, 0.25);
  first.finish(false);
  assert.equal(reportFirst({ stage: "converting" }), false);
});

test("EPUB chapter measurements remain running until the complete archive is validated", t => {
  const { registry } = fixture(t), id = randomUUID(), scope = registry.create(id);
  assert.equal(scope.report({ stage: "converting", completed: 3, total: 4, unit: "chapters" }), true);
  assert.equal(registry.get(id).unit, "chapters");
  assert.equal(registry.get(id).completed, 3);
  const before = registry.get(id);
  for (const completed of [3.5, 5, -1]) {
    assert.equal(scope.report({ stage: "converting", completed, total: 4, unit: "chapters" }), false);
    assert.deepEqual(registry.get(id), before);
  }
  assert.equal(scope.report({ stage: "converting", completed: 4, total: 4, unit: "chapters" }), true);
  assert.equal(registry.get(id).status, "running", "chapter completion is not archive or request completion");
  assert.equal(scope.report({ stage: "validating" }), true);
  assert.equal(registry.get(id).completed, null);
  assert.equal(registry.get(id).unit, null);
  scope.finish(false);
  assert.equal(scope.report({ stage: "converting", completed: 4, total: 4, unit: "chapters" }), false);
  assert.equal(registry.get(id).status, "failed");
});

test("registry bounds memory, expires receipts, and rejects late reports from a reused ID epoch", t => {
  const { registry, advance } = fixture(t, { maxEntries: 2, terminalTtlMs: 20, runningTtlMs: 100 });
  const a = randomUUID(), b = randomUUID(), c = randomUUID();
  const old = registry.create(a); registry.create(b);
  assert.throws(() => registry.create(a), { code: "PROGRESS_ID_IN_USE", status: 409 });
  assert.throws(() => registry.create(c), { code: "PROGRESS_CAPACITY_REACHED", status: 503 });
  old.finish(true); registry.create(c);
  assert.equal(registry.size(), 2); assert.equal(registry.get(a), null);
  advance(101); assert.equal(registry.size(), 0);
  const fresh = registry.create(a);
  assert.equal(old.report({ stage: "failed" }), false);
  assert.equal(old.finish(false), false);
  fresh.report({ stage: "merging", completed: 1, total: 2, unit: "files" });
  assert.equal(registry.get(a).status, "running");
  fresh.finish(false); advance(21); assert.equal(registry.get(a), null);
});

test("invalid IDs, terminal engine reports and invented counter values cannot pollute progress", t => {
  const { registry } = fixture(t), id = randomUUID(), scope = registry.create(id);
  for (const bad of ["../private", "not-a-uuid", [id], id + "," + id]) assert.throws(() => registry.create(bad), { code: "INVALID_PROGRESS_ID" });
  const before = registry.get(id);
  for (const event of [null, {}, { stage: "completed" }, { stage: "failed" }, { stage: "secret/path" },
    { stage: "converting", completed: NaN, total: 10, unit: "pages" },
    { stage: "converting", completed: 11, total: 10, unit: "pages" },
    { stage: "converting", completed: 0.2, total: 10, unit: "pages" },
    { stage: "converting", completed: 1, total: 10 },
    { stage: "converting", completed: 0, total: 0, unit: "bytes" }]) assert.equal(scope.report(event), false);
  assert.deepEqual(registry.get(id), before);
});

test("HTTP finish 200 without registered output never becomes succeeded; abort ignores late ready", t => {
  const { registry } = fixture(t), lifecycle = createProgressHttpLifecycle(registry);
  function request() {
    const id = randomUUID(), req = new EventEmitter(), res = new EventEmitter();
    req.headers = { "x-flyingmouse-progress-id": id }; res.statusCode = 200;
    lifecycle.begin(req, res, () => {});
    return { id, req, res };
  }
  const validation = request();
  // A handler can return {ok:false} with HTTP 200; HTTP status is insufficient.
  validation.res.emit("finish"); assert.equal(registry.get(validation.id).status, "failed");
  const cancelled = request(); cancelled.req.emit("aborted");
  lifecycle.outputReady(cancelled.req); cancelled.res.emit("finish");
  assert.equal(registry.get(cancelled.id).status, "failed");
  const ready = request(); lifecycle.outputReady(ready.req); ready.res.emit("finish");
  assert.equal(registry.get(ready.id).status, "succeeded");
  assert.equal(ready.req.listenerCount("data"), 0); assert.equal(ready.res.listenerCount("close"), 0);
});
