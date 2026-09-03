const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { loadWithOverrides } = require("./helpers/load-with-overrides");

function loadServer(overrides) {
  return loadWithOverrides(path.join(__dirname, "..", "server.js"), {
    "./utils": { ...require("../utils"), commandExists: overrides.commandExists },
    "./office-engine": { ...require("../office-engine"), probeLibreOffice: overrides.probeLibreOffice },
    "./ocr": { ocrAvailable: () => true },
    "./logger": { ...require("../logger"), warn() {} }
  });
}

test("concurrent capability callers share one parallel probe and cache its result", async () => {
  const started = [];
  const release = [];
  const probe = (name, result) => {
    started.push(name);
    return new Promise((resolve) => release.push(() => resolve(result)));
  };
  const server = loadServer({
    probeLibreOffice: () => probe("office", { enabled: true, version: "fixture" }),
    commandExists: (_command, args) => probe(args ? "poppler" : "ffmpeg", true)
  });
  const requests = Array.from({ length: 30 }, () => server.getToolDiagnostics());
  assert.deepEqual(started, ["office", "ffmpeg", "poppler"], "all engines start before any has completed");
  release.forEach((finish) => finish());
  const results = await Promise.all(requests);
  assert.equal(results.every((result) => result.libreoffice.enabled && result.ffmpeg.enabled && result.poppler.enabled), true);
  assert.equal((await server.getToolDiagnostics()).libreoffice.version, "fixture");
  assert.equal(started.length, 3);
});

test("an unavailable Office engine retains diagnostics without disabling other engines", async () => {
  const messages = { zhCN: "不可用", enUS: "Unavailable" };
  let calls = 0;
  const server = loadServer({
    probeLibreOffice: async () => { calls += 1; throw Object.assign(new Error("missing"), { code: "OFFICE_ENGINE_MISSING", messages }); },
    commandExists: async () => true
  });
  const results = await Promise.all([server.getToolDiagnostics(), server.getToolDiagnostics()]);
  assert.equal(calls, 1);
  assert.equal(results[0].libreoffice.enabled, false);
  assert.equal(results[0].libreoffice.errorCode, "OFFICE_ENGINE_MISSING");
  assert.deepEqual(results[0].libreoffice.messages, messages);
  assert.equal(results[0].ffmpeg.enabled, true);
});

test("unexpected probe failures are shared but are not cached forever", async () => {
  const failure = new Error("transient probe failure");
  let retry = false;
  let officeCalls = 0;
  const server = loadServer({
    probeLibreOffice: async () => { officeCalls += 1; return { enabled: true }; },
    commandExists: async () => { if (!retry) throw failure; return true; }
  });
  const results = await Promise.allSettled([server.getToolDiagnostics(), server.getToolDiagnostics()]);
  assert.equal(results.every((result) => result.status === "rejected" && result.reason === failure), true);
  assert.equal(officeCalls, 1);
  retry = true;
  assert.equal((await server.getToolDiagnostics()).ffmpeg.enabled, true);
  assert.equal(officeCalls, 2);
});
