"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");
const { performance } = require("node:perf_hooks");

const context = new AsyncLocalStorage();
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGES = new Set(["uploading", "preparing", "queued", "recognizing", "converting", "merging", "validating"]);
const UNITS = new Set(["bytes", "pages", "files", "seconds", "chapters"]);

function normalizeId(id) {
  return typeof id === "string" && ID_PATTERN.test(id) ? id.toLowerCase() : null;
}

function progressError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function normalizeEvent(event) {
  if (!event || !STAGES.has(event.stage)) return null;
  const completed = event.completed ?? null;
  const total = event.total ?? null;
  const unit = event.unit ?? null;
  if (unit === null) return completed === null && total === null ? { stage: event.stage, completed, total, unit } : null;
  if (!UNITS.has(unit)) return null;
  const valid = value => value === null || (Number.isFinite(value) && value >= 0 && (unit === "seconds" || Number.isSafeInteger(value)));
  if (!valid(completed) || !valid(total) || (total !== null && (total <= 0 || (completed !== null && completed > total)))) return null;
  return { stage: event.stage, completed, total, unit };
}

function createProgressRegistry({ maxEntries = 256, terminalTtlMs = 10 * 60 * 1000,
  runningTtlMs = 24 * 60 * 60 * 1000, now = Date.now,
  monotonicNow = () => performance.now(), sweepIntervalMs = 60 * 1000 } = {}) {
  const entries = new Map();
  function sweep() {
    const current = monotonicNow();
    for (const [id, entry] of entries) {
      const ttl = entry.status === "running" ? runningTtlMs : terminalTtlMs;
      if (current - entry.touched >= ttl) entries.delete(id);
    }
  }
  const timer = sweepIntervalMs > 0 ? setInterval(sweep, sweepIntervalMs) : null;
  timer?.unref?.();
  function snapshot(entry) {
    return { id: entry.id, status: entry.status, stage: entry.stage,
      completed: entry.completed, total: entry.total, unit: entry.unit,
      elapsedMs: Math.max(0, Math.floor((entry.ended ?? monotonicNow()) - entry.started)), updatedAt: entry.updatedAt };
  }
  function create(value) {
    const id = normalizeId(value);
    if (!id) throw progressError("INVALID_PROGRESS_ID", 400);
    sweep();
    if (entries.has(id)) throw progressError("PROGRESS_ID_IN_USE", 409);
    if (entries.size >= maxEntries) {
      // Preserve live operations. Completed receipts are a bounded polling
      // cache, not a persistent history of filenames or conversions.
      const oldest = [...entries.values()].filter(entry => entry.status !== "running")
        .sort((a, b) => a.touched - b.touched)[0];
      if (oldest) entries.delete(oldest.id);
    }
    if (entries.size >= maxEntries) throw progressError("PROGRESS_CAPACITY_REACHED", 503);
    const started = monotonicNow();
    const entry = { id, status: "running", stage: "uploading", completed: null, total: null, unit: null,
      started, touched: started, updatedAt: now(), ended: null };
    entries.set(id, entry);
    const active = () => entries.get(id) === entry && entry.status === "running";
    return {
      report(event) {
        sweep();
        const normalized = normalizeEvent(event);
        if (!active() || !normalized) return false;
        // Every report is a complete stage measurement. Omitted quantities
        // clear previous-stage counters instead of reusing a stale percentage.
        Object.assign(entry, normalized, { touched: monotonicNow(), updatedAt: now() });
        return true;
      },
      finish(succeeded) {
        sweep();
        if (!active()) return false;
        const ended = monotonicNow();
        Object.assign(entry, { status: succeeded ? "succeeded" : "failed", stage: succeeded ? "completed" : "failed",
          completed: null, total: null, unit: null, ended, touched: ended, updatedAt: now() });
        return true;
      }
    };
  }
  return { create, sweep,
    get(id) { sweep(); const entry = entries.get(normalizeId(id)); return entry ? snapshot(entry) : null; },
    size() { sweep(); return entries.size; },
    dispose() { if (timer) clearInterval(timer); entries.clear(); }
  };
}

function withConversionProgress(scope, callback) { return context.run(scope || null, callback); }
function reportConversionProgress(event) { return context.getStore()?.report(event) || false; }
function captureConversionProgressReporter() {
  const scope = context.getStore();
  return event => scope?.report(event) || false;
}

function createProgressHttpLifecycle(registry = createProgressRegistry()) {
  const requests = new WeakMap();
  function begin(req, res, next) {
    const id = req.headers["x-flyingmouse-progress-id"];
    if (id === undefined) return next();
    let scope;
    try { scope = registry.create(id); }
    catch (error) { res.status(error.status || 400).json({ error: error.code, errorCode: error.code }); return; }
    const operation = { scope, ready: false };
    requests.set(req, operation);
    const length = req.headers["content-length"];
    const total = typeof length === "string" && /^\d+$/.test(length) && Number.isSafeInteger(Number(length)) && Number(length) > 0 ? Number(length) : null;
    let bytes = 0;
    scope.report({ stage: "uploading", completed: 0, total, unit: "bytes" });
    const data = chunk => { bytes += chunk.length; scope.report({ stage: "uploading", completed: bytes, total, unit: "bytes" }); };
    const endUpload = () => { req.removeListener("data", data); req.removeListener("end", endUpload); };
    const aborted = () => { scope.finish(false); endUpload(); };
    const closed = () => { if (!res.writableFinished) scope.finish(false); cleanup(); };
    const finished = () => { scope.finish(operation.ready && res.statusCode >= 200 && res.statusCode < 300); cleanup(); };
    function cleanup() {
      endUpload(); req.removeListener("aborted", aborted);
      res.removeListener("close", closed); res.removeListener("finish", finished);
    }
    req.on("data", data); req.once("end", endUpload); req.once("aborted", aborted);
    res.once("close", closed); res.once("finish", finished);
    withConversionProgress(scope, next);
  }
  return { registry, begin,
    enter(req, _res, next) {
      // Multipart stream callbacks need not preserve the ALS context in which
      // middleware was registered. Re-enter explicitly at the handler boundary.
      withConversionProgress(requests.get(req)?.scope, () => {
        reportConversionProgress({ stage: "preparing" }); next();
      });
    },
    outputReady(req) { const operation = requests.get(req); if (operation) operation.ready = true; },
    get(req, res) {
      res.setHeader("Cache-Control", "no-store");
      if (!normalizeId(req.params.id)) { res.status(400).json({ errorCode: "INVALID_PROGRESS_ID" }); return; }
      const snapshot = registry.get(req.params.id);
      if (!snapshot) { res.status(404).json({ errorCode: "PROGRESS_NOT_FOUND" }); return; }
      res.json(snapshot);
    }
  };
}

module.exports = { createProgressRegistry, withConversionProgress, reportConversionProgress,
  captureConversionProgressReporter, createProgressHttpLifecycle };
