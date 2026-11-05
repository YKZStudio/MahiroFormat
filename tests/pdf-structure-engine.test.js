const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile: execFileCallback } = require("node:child_process");
const { promisify } = require("node:util");
const { test } = require("node:test");

const {
  DEFAULT_MAX_BUFFER_BYTES,
  DEFAULT_TIMEOUT_MS,
  structuredPdfThreadBudget,
  REQUIRED_MODELS,
  getStructuredPdfAvailability,
  preflightStructuredPdf,
  createStructuredPdfBoundary: createUnconfiguredBoundary
} = require("../src/pdf-structure-engine");
// These fixtures replace native inference, so their memory availability must
// not depend on how much RAM the CI worker happens to have left. Admission
// tests below inject their own changing snapshots or exercise the OS default.
const GiB = 1024 ** 3;
const createStructuredPdfBoundary = (dependencies = {}) => createUnconfiguredBoundary({ getFreeMemory: () => 8 * GiB, ...dependencies });
const withStructuredPdf = createStructuredPdfBoundary();
const realExecFile = promisify(execFileCallback);
const { withConversionProgress } = require("../src/conversion-progress");

test("model memory admission rejects a 4 GiB machine before preflight or native execution", async t => {
  const harness = await createHarness(t);
  let preflights = 0, calls = 0;
  const boundary = createStructuredPdfBoundary({ getFreeMemory: () => 3.5 * GiB,
    preflightPdf: async () => { preflights++; return { pageCount: 1 }; } });
  await assert.rejects(boundary(harness.inputPath, options(harness, () => { calls++; }), async () => {}), error => {
    assert.equal(error.code, "PDF_STRUCTURE_MEMORY_INSUFFICIENT");
    assert.deepEqual(error.details, { minimumFreeBytes: 5 * GiB, availableBytes: 3.5 * GiB });
    assert.match(error.messages.zhCN, /3\.5.*5/); assert.match(error.messages.enUS, /3\.5.*5/);
    assert.match(error.messages.zhCN, /PDF.*TXT/); return true;
  });
  assert.equal(preflights, 0); assert.equal(calls, 0);
  assert.deepEqual(await fsp.readdir(harness.runtimeDir), []);
});

test("model memory admission allows the exact threshold without changing parsed output", async t => {
  const harness = await createHarness(t); let reads = 0, calls = 0;
  const boundary = createStructuredPdfBoundary({ getFreeMemory: () => { reads++; return 5 * GiB; } });
  const result = await boundary(harness.inputPath, options(harness, async (_file, args) => {
    calls++; await fsp.writeFile(path.join(args[4], "manifest.json"), JSON.stringify(validManifest()));
  }), async manifest => manifest);
  assert.deepEqual(result, validManifest()); assert.equal(calls, 1); assert.equal(reads, 2);
});

test("model memory admission reads again after preflight before the first spawn", async t => {
  const harness = await createHarness(t); let reads = 0, calls = 0;
  const boundary = createStructuredPdfBoundary({ getFreeMemory: () => ++reads === 1 ? 8 * GiB : GiB });
  await expectCode(boundary(harness.inputPath, options(harness, () => { calls++; }), async () => {}), "PDF_STRUCTURE_MEMORY_INSUFFICIENT");
  assert.equal(reads, 2); assert.equal(calls, 0); assert.deepEqual(await fsp.readdir(harness.runtimeDir), []);
});

test("model memory admission checks after dequeue and releases the rejected slot", async t => {
  const harness = await createHarness(t); let entered, release, calls = 0, secondReads = 0, free = 8 * GiB;
  const started = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const runOptions = options(harness, async (_file, args) => { calls++; await fsp.writeFile(path.join(args[4], "manifest.json"), JSON.stringify(validManifest())); });
  const first = withStructuredPdf(harness.inputPath, runOptions, async () => { entered(); await hold; return "first"; });
  await started;
  const second = createStructuredPdfBoundary({ getFreeMemory: () => { secondReads++; return free; } })(harness.inputPath, runOptions, async () => assert.fail("low-memory request consumed"));
  const rejected = expectCode(second, "PDF_STRUCTURE_MEMORY_INSUFFICIENT");
  assert.equal(secondReads, 0); free = GiB; release();
  assert.equal(await first, "first"); await rejected;
  assert.equal(secondReads, 1); assert.equal(calls, 1);
  assert.equal(await withStructuredPdf(harness.inputPath, runOptions, async () => "next"), "next");
  assert.equal(calls, 2); assert.deepEqual(await fsp.readdir(harness.runtimeDir), []);
});

test("model memory admission blocks the next batch when available memory drops", async t => {
  const harness = await smallBatches(t); let reads = 0, calls = 0;
  const boundary = createStructuredPdfBoundary({ getFreeMemory: () => ++reads <= 2 ? 8 * GiB : GiB });
  await expectCode(boundary(harness.inputPath, { ...harness, execFile: async (_file, args) => {
    calls++; await writeBatchManifest(args);
  } }, async () => assert.fail("incomplete output consumed")), "PDF_STRUCTURE_MEMORY_INSUFFICIENT");
  assert.equal(reads, 3); assert.equal(calls, 1); assert.deepEqual(await fsp.readdir(harness.runtimeDir), []);
});

test("model memory admission fails closed for invalid or failed readings without leaking causes", async t => {
  const harness = await createHarness(t); let calls = 0;
  for (const value of [undefined, NaN, Infinity, -1, "8 GiB", new Error("private probe details")]) {
    const boundary = createStructuredPdfBoundary({ getFreeMemory: () => { if (value instanceof Error) throw value; return value; } });
    await assert.rejects(boundary(harness.inputPath, options(harness, () => { calls++; }), async () => {}), error => {
      assert.equal(error.code, "PDF_STRUCTURE_MEMORY_INSUFFICIENT");
      assert.equal(error.details.availableBytes, null); assert.equal(error.details.minimumFreeBytes, 5 * GiB);
      assert.match(error.messages.zhCN, /无法读取/); assert.match(error.messages.enUS, /unavailable/);
      assert.ok(!error.message.includes("private probe details")); return true;
    });
  }
  assert.equal(calls, 0);
});

test("model memory admission preserves cancellation priority before and during a reading", async t => {
  const harness = await createHarness(t); let reads = 0, calls = 0;
  for (const alreadyCanceled of [true, false]) {
    const controller = new AbortController(); if (alreadyCanceled) controller.abort();
    const boundary = createStructuredPdfBoundary({ getFreeMemory: () => { reads++; controller.abort(); return 0; } });
    await expectCode(boundary(harness.inputPath, { ...options(harness, () => { calls++; }), signal: controller.signal }, async () => {}), "CONVERSION_CANCELED");
  }
  assert.equal(reads, 1); assert.equal(calls, 0);
});

test("model memory admission preserves missing-engine/model and Lite guidance before querying RAM", async t => {
  for (const missing of ["engine", "model", "lite"]) {
    const harness = await createHarness(t); let reads = 0;
    await fsp.rm(missing === "model" ? harness.modelDirectory : harness.enginePath, { recursive: true });
    const boundary = createStructuredPdfBoundary({ getFreeMemory: () => { reads++; return GiB; } });
    await assert.rejects(boundary(harness.inputPath, { ...harness, engineProfile: missing === "lite" ? "lite" : undefined }, async () => {}), error => {
      assert.equal(error.code, missing === "model" ? "PDF_STRUCTURE_MODEL_MISSING" : "PDF_STRUCTURE_ENGINE_MISSING");
      if (missing === "lite") assert.match(error.messages.zhCN, /轻量版/);
      return true;
    });
    assert.equal(reads, 0);
  }
});

test("cancellation during availability checks takes priority over memory or missing-engine errors", async t => {
  const harness = await createHarness(t), controller = new AbortController();
  await fsp.rm(harness.enginePath);
  const boundary = createStructuredPdfBoundary({ getFreeMemory: () => assert.fail("canceled admission queried RAM"),
    fileSystem: { ...fsp, async lstat(file) { controller.abort(); return fsp.lstat(file); } } });
  await expectCode(boundary(harness.inputPath, { ...harness, signal: controller.signal }, async () => {}), "CONVERSION_CANCELED");
});

test("the default model memory reader is live and does not gate ordinary PDF text OCR", async t => {
  const harness = await createHarness(t); let reads = 0;
  t.mock.method(os, "freemem", () => { reads++; return GiB; });
  await expectCode(createUnconfiguredBoundary()(harness.inputPath, options(harness, () => assert.fail("low-memory native spawn")), async () => {}), "PDF_STRUCTURE_MEMORY_INSUFFICIENT");
  assert.equal(reads, 1);
  const { fillMissingPdfPageText } = require("../src/pdf");
  const before = reads; let terminated = false;
  const pages = await fillMissingPdfPageText("unused.pdf", [{ pageNumber: 1, rows: [] }], {
    ocrAvailable: () => true, createOcrWorker: async () => ({ terminate: async () => { terminated = true; } }),
    renderPdfTablePage: async () => ({ outputPath: "scan.png" }),
    recognizeImageResultWithWorker: async () => ({ text: "普通OCR保留1186.00", warnings: [] })
  });
  assert.equal(pages[0].rows.flat().join(""), "普通OCR保留1186.00"); assert.ok(terminated);
  assert.equal(reads, before, "ordinary OCR must not consult the advanced model admission guard");
});

test("registers the runner test and development engine/model candidates", () => {
  const packageJson = require("../package.json");
  assert.match(`${packageJson.scripts.pretest || ""} ${packageJson.scripts.test}`, /tests\/pdf-structure-engine\.test\.js/);
  assert.match(`${packageJson.scripts["pretest:ci"] || ""} ${packageJson.scripts["test:ci"]}`, /tests\/pdf-structure-engine\.test\.js/);
  const configSource = require("node:fs").readFileSync(path.join(__dirname, "..", "src/config.js"), "utf8");
  assert.match(configSource, /bin["'],\s*["']docstructure["'],\s*["']docstructure-engine\.exe/);
  assert.match(configSource, /bin["'],\s*["']docstructure["'],\s*["']models/);
});

async function createHarness(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "fm-engine-test-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const enginePath = path.join(root, "docstructure-engine.exe");
  const modelDirectory = path.join(root, "models");
  const inputPath = path.join(root, "input.pdf");
  const runtimeDir = path.join(root, "runtime");
  await fsp.writeFile(enginePath, "engine");
  // macOS/Linux 上可执行性检查（access X_OK）要求文件有 exec bit——fake 引擎需要 chmod，
  // 否则 mac CI 会误报 ENGINE_MISSING 而非预期的 MODEL_MISSING（Windows 无此语义，无害）。
  await fsp.chmod(enginePath, 0o755);
  await fsp.mkdir(modelDirectory);
  for (const name of REQUIRED_MODELS) {
    const model = path.join(modelDirectory, name);
    await fsp.mkdir(model);
    for (const file of ["inference.json", "inference.pdiparams", "inference.yml"]) {
      await fsp.writeFile(path.join(model, file), "test model");
    }
  }
  await fsp.mkdir(runtimeDir);
  const pdf = await require("pdf-lib").PDFDocument.create();
  pdf.addPage([100, 100]);
  await fsp.writeFile(inputPath, await pdf.save());
  return { enginePath, modelDirectory, inputPath, runtimeDir };
}

function validManifest() {
  return { schemaVersion: 1, engine: { name: "test", version: "1" }, pages: [
    { pageNumber: 1, width: 200, height: 200, rotation: 0, referenceImage: "page-001.png", blocks: [], tables: [] }
  ] };
}

function options(harness, execFile, validateManifest = (manifest) => Object.freeze(manifest)) {
  return { ...harness, execFile, validateManifest };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    assert.ok(!error.message.includes("input.pdf"));
    return true;
  });
}

test("fails before spawning when the executable is absent", async (t) => {
  const harness = await createHarness(t);
  await fsp.rm(harness.enginePath);
  let spawned = false;
  await expectCode(withStructuredPdf(harness.inputPath, options(harness, () => { spawned = true; }), async () => {}), "PDF_STRUCTURE_ENGINE_MISSING");
  assert.equal(spawned, false);
});

test("fails before spawning when the model directory is absent", async (t) => {
  const harness = await createHarness(t);
  await fsp.rm(harness.modelDirectory, { recursive: true });
  let spawned = false;
  await expectCode(withStructuredPdf(harness.inputPath, options(harness, () => { spawned = true; }), async () => {}), "PDF_STRUCTURE_MODEL_MISSING");
  assert.equal(spawned, false);
});

test("uses exact private parse arguments, no shell, and a ten-minute timeout", async (t) => {
  const harness = await createHarness(t);
  let call;
  const result = await withStructuredPdf(harness.inputPath, options(harness, async (file, args, processOptions) => {
    call = { file, args, processOptions };
    await fsp.writeFile(path.join(args[4], "manifest.json"), JSON.stringify(validManifest()));
  }), async () => "ok");
  assert.equal(result, "ok");
  assert.equal(call.file, harness.enginePath);
  assert.equal(call.processOptions.shell, false);
  assert.equal(call.processOptions.timeout, 600000);
  assert.equal(call.processOptions.maxBuffer, DEFAULT_MAX_BUFFER_BYTES);
  assert.equal(DEFAULT_TIMEOUT_MS, 10 * 60 * 1000);
  assert.deepEqual(call.args.slice(0, 4), ["parse", "--input", harness.inputPath, "--output"]);
  assert.equal(path.dirname(call.args[4]), harness.runtimeDir);
  assert.match(path.basename(call.args[4]), /^fm-pdf-structure-/);
  assert.deepEqual(call.args.slice(5), ["--models", harness.modelDirectory, "--language", "ch"]);
});

test("budgets native calculation threads without occupying every available core", () => {
  for (const [available, expected] of [[1, 1], [2, 1], [3, 1], [4, 2], [8, 4], [32, 4], [0, 1], [NaN, 1]]) {
    assert.equal(structuredPdfThreadBudget(available), expected);
  }
});

test("supports runtimes without availableParallelism", () => {
  const parallelism = os.availableParallelism;
  const cpus = os.cpus;
  try {
    os.availableParallelism = undefined;
    os.cpus = () => [{}, {}, {}, {}];
    assert.equal(structuredPdfThreadBudget(), 2);
  } finally {
    os.availableParallelism = parallelism;
    os.cpus = cpus;
  }
});

test("sets the native thread budget before child initialization without changing the parent environment", async t => {
  const harness = await createHarness(t);
  const previous = { OMP_NUM_THREADS: process.env.OMP_NUM_THREADS, MKL_NUM_THREADS: process.env.MKL_NUM_THREADS };
  process.env.OMP_NUM_THREADS = "99";
  process.env.MKL_NUM_THREADS = "98";
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  await withStructuredPdf(harness.inputPath, options(harness, async (_file, args, processOptions) => {
    const result = await realExecFile(process.execPath, ["-e",
      "process.stdout.write(JSON.stringify([process.env.OMP_NUM_THREADS, process.env.MKL_NUM_THREADS]))"], processOptions);
    const budget = String(structuredPdfThreadBudget());
    assert.deepEqual(JSON.parse(result.stdout), [budget, budget]);
    assert.equal(process.env.OMP_NUM_THREADS, "99");
    assert.equal(process.env.MKL_NUM_THREADS, "98");
    await fsp.writeFile(path.join(args[4], "manifest.json"), JSON.stringify(validManifest()));
  }), async () => {});
});

test("serializes complete structured requests across boundaries, including their consumers", async t => {
  const harness = await createHarness(t);
  const firstProgress = [], secondProgress = [];
  let entered, release;
  const consuming = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const timeouts = [];
  const runOptions = options(harness, async (_file, args, processOptions) => {
    calls += 1;
    timeouts.push(processOptions.timeout);
    await fsp.writeFile(path.join(args[4], "manifest.json"), JSON.stringify(validManifest()));
  });
  const first = withConversionProgress({ report: event => firstProgress.push(event) }, () =>
    createStructuredPdfBoundary()(harness.inputPath, runOptions, async () => { entered(); await hold; return "first"; }));
  await consuming;
  const second = withConversionProgress({ report: event => secondProgress.push(event) }, () =>
    createStructuredPdfBoundary()(harness.inputPath, { ...runOptions, timeoutMs: 25 }, async () => "second"));
  try {
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(calls, 1, "the waiting request must not initialize another native model instance");
    assert.deepEqual(secondProgress, [{ stage: "queued" }]);
    assert.deepEqual(firstProgress.at(-1), { stage: "converting" }, "output consumer has unknown conversion work, not completed recognition counts");
  } finally {
    release();
    assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  }
  assert.equal(calls, 2);
  assert.deepEqual(secondProgress.at(-1), { stage: "converting" });
  assert.deepEqual(timeouts, [DEFAULT_TIMEOUT_MS, 25], "queue waiting must not consume the native execution timeout");
  assert.deepEqual(await fsp.readdir(harness.runtimeDir), []);
});

test("cancels a queued structured request promptly and releases the next request after consumer failure", async t => {
  const harness = await createHarness(t);
  let entered, release;
  const consuming = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const runOptions = options(harness, async (_file, args) => {
    calls += 1;
    await fsp.writeFile(path.join(args[4], "manifest.json"), JSON.stringify(validManifest()));
  });
  const failure = new Error("consumer failed");
  const first = withStructuredPdf(harness.inputPath, runOptions, async () => { entered(); await hold; throw failure; });
  const firstRejected = assert.rejects(first, error => error === failure);
  await consuming;
  const controller = new AbortController();
  const canceled = withStructuredPdf(harness.inputPath, { ...runOptions, signal: controller.signal }, async () => assert.fail("canceled request consumed"));
  const canceledRejected = expectCode(canceled, "CONVERSION_CANCELED");
  const third = withStructuredPdf(harness.inputPath, runOptions, async () => "third");
  try {
    controller.abort();
    await Promise.race([canceledRejected, new Promise((_, reject) => setTimeout(() => reject(new Error("queued cancellation stalled")), 300))]);
    assert.equal(calls, 1);
  } finally {
    release();
    await firstRejected;
    await canceledRejected;
    assert.equal(await third, "third");
  }
  assert.equal(calls, 2);
  assert.deepEqual(await fsp.readdir(harness.runtimeDir), []);
});

test("application shutdown cancels queued requests before another model starts", async t => {
  const harness = await createHarness(t);
  const script = `
    const path = require('node:path'), fs = require('node:fs/promises');
    const { createStructuredPdfBoundary } = require(process.argv[1]);
    const { beginApplicationShutdown } = require(process.argv[2]);
    const harness = JSON.parse(process.argv[3]);
    let started, release, calls = 0;
    const entered = new Promise(resolve => { started = resolve; });
    const hold = new Promise(resolve => { release = resolve; });
    const boundary = createStructuredPdfBoundary({ getFreeMemory: () => 8 * 1024 ** 3, preflightPdf: async () => ({ pageCount: 1 }) });
    const options = { ...harness, execFile: async (_file, args) => {
      calls++; started(); await hold;
      await fs.writeFile(path.join(args[4], 'manifest.json'), '{}');
    } };
    (async () => {
      const first = boundary(harness.inputPath, options, () => {}).catch(error => error.code);
      await entered;
      const second = boundary(harness.inputPath, options, () => {}).catch(error => error.code);
      beginApplicationShutdown();
      release();
      process.stdout.write(JSON.stringify({ codes: await Promise.all([first, second]), calls,
        remaining: await fs.readdir(harness.runtimeDir) }));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = await realExecFile(process.execPath, ["-e", script,
    path.join(__dirname, "..", "src/pdf-structure-engine.js"),
    path.join(__dirname, "..", "src/conversion-cancellation.js"), JSON.stringify(harness)], { timeout: 10000, windowsHide: true });
  assert.deepEqual(JSON.parse(result.stdout), { codes: ["CONVERSION_CANCELED", "CONVERSION_CANCELED"], calls: 1, remaining: [] });
});

test("injects a short timeout into a real direct child and cleans scratch", async (t) => {
  const harness = await createHarness(t);
  let scratch;
  let observedTimeout;
  const runOptions = options(harness, async (_file, args, processOptions) => {
    scratch = args[4];
    observedTimeout = processOptions.timeout;
    return realExecFile(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      ...processOptions,
      timeout: Math.min(processOptions.timeout, 100)
    });
  });
  runOptions.timeoutMs = 40;

  await expectCode(
    withStructuredPdf(harness.inputPath, runOptions, async () => {}),
    "PDF_STRUCTURE_PARSE_FAILED"
  );
  assert.equal(observedTimeout, 40);
  assert.ok(scratch);
  await assert.rejects(fsp.access(scratch));
  assert.deepEqual(await fsp.readdir(harness.runtimeDir), []);
});

for (const [name, failure] of [
  ["nonzero exit", Object.assign(new Error("private source text"), { code: 139, stderr: "secret OCR" })],
  ["timeout", Object.assign(new Error("timed out at private path"), { code: "ETIMEDOUT", killed: true })]
]) {
  test(`redacts ${name} failures`, async (t) => {
    const harness = await createHarness(t);
    await expectCode(withStructuredPdf(harness.inputPath, options(harness, async () => { throw failure; }), async () => {}), "PDF_STRUCTURE_PARSE_FAILED");
  });
}

// 2026-09-07：引擎 segfault（SIGSEGV，重跑可成功）与 10 分钟超时（需拆文件）
// 的用户动作不同，文案必须区分；两者错误码保持 PDF_STRUCTURE_PARSE_FAILED 不变。
test("separates timeout and engine-crash user messages", async (t) => {
  const harness = await createHarness(t);
  const cases = [
    [Object.assign(new Error("timed out"), { code: "ETIMEDOUT", killed: true }), "超时"],
    [Object.assign(new Error("crashed"), { code: null, signal: "SIGSEGV", killed: false }), "意外退出"]
  ];
  for (const [failure, needle] of cases) {
    await assert.rejects(
      withStructuredPdf(harness.inputPath, options(harness, async () => { throw failure; }), async () => {}),
      (error) => {
        assert.equal(error.code, "PDF_STRUCTURE_PARSE_FAILED");
        assert.ok(String(error.messages?.zhCN || "").includes(needle), `expected "${needle}" in ${error.messages?.zhCN}`);
        return true;
      }
    );
  }
});

test("collapses engine exit status and output without retaining a cause", async (t) => {
  const harness = await createHarness(t);
  const privateFailure = Object.assign(new Error("private source path"), {
    code: 23,
    stdout: "recognized private text",
    stderr: "private model status"
  });
  await assert.rejects(
    withStructuredPdf(harness.inputPath, options(harness, async () => { throw privateFailure; }), async () => {}),
    (error) => {
      assert.equal(error.code, "PDF_STRUCTURE_RESOURCE_LIMIT");
      assert.equal(error.cause, undefined);
      assert.equal(error.status, undefined);
      assert.doesNotMatch(JSON.stringify(error), /private|recognized|23/);
      return true;
    }
  );
});

test("Lite availability and missing-engine guidance preserve the fallback error code", async (t) => {
  const harness = await createHarness(t);
  await fsp.rm(harness.enginePath);
  assert.equal((await getStructuredPdfAvailability({ ...harness, engineProfile: "lite" })).profile, "lite");
  assert.equal((await getStructuredPdfAvailability({ ...harness, engineProfile: "full" })).profile, undefined);
  await assert.rejects(withStructuredPdf(harness.inputPath, { ...harness, engineProfile: "lite" }, async () => {}), (error) => {
    assert.equal(error.code, "PDF_STRUCTURE_ENGINE_MISSING");
    assert.match(error.messages.zhCN, /轻量版.*完整版/u);
    assert.match(error.messages.enUS, /Lite.*Full/u);
    return true;
  });
});

test("reports native model, resource, output and launch failures without stderr", async (t) => {
  const harness = await createHarness(t);
  for (const [code, expected] of [[20, "PDF_STRUCTURE_MODEL_MISSING"],
    [23, "PDF_STRUCTURE_RESOURCE_LIMIT"], [22, "PDF_STRUCTURE_SCHEMA_INVALID"],
    [21, "PDF_STRUCTURE_PARSE_FAILED"], ["ENOENT", "PDF_STRUCTURE_ENGINE_MISSING"]]) {
    const failure = Object.assign(new Error("private"), { code, stderr: "private OCR\nMODEL_MISSING" });
    await expectCode(withStructuredPdf(harness.inputPath, options(harness, async () => { throw failure; }), async () => {}), expected);
  }
});

test("empty and truncated models are unavailable before any expensive process starts", async (t) => {
  const harness = await createHarness(t);
  assert.equal((await getStructuredPdfAvailability(harness)).enabled, true);
  await fsp.writeFile(path.join(harness.modelDirectory, "text_detection", "inference.pdiparams"), "");
  const availability = await getStructuredPdfAvailability(harness);
  assert.equal(availability.enabled, false);
  assert.equal(availability.errorCode, "PDF_STRUCTURE_MODEL_MISSING");
  assert.equal(availability.limits.maxTotalPixels, 100000000);
  assert.doesNotMatch(JSON.stringify(availability), /fm-engine-test-/);
  let called = false;
  await expectCode(withStructuredPdf(harness.inputPath, options(harness, async () => { called = true; }), async () => {}), "PDF_STRUCTURE_MODEL_MISSING");
  assert.equal(called, false);
});

test("an empty engine executable is unavailable", async (t) => {
  const harness = await createHarness(t);
  await fsp.writeFile(harness.enginePath, "");
  assert.equal((await getStructuredPdfAvailability(harness)).errorCode, "PDF_STRUCTURE_ENGINE_MISSING");
});

test("an oversized manifest is rejected before reading it into memory", async (t) => {
  const harness = await createHarness(t);
  let manifestRead = false;
  const boundary = createStructuredPdfBoundary({ fileSystem: {
    ...fsp,
    async lstat(file) {
      const stats = await fsp.lstat(file);
      if (path.basename(file) === "manifest.json") stats.size = 512 * 1024 * 1024 + 1;
      return stats;
    },
    async readFile(file, ...args) {
      if (path.basename(file) === "manifest.json") manifestRead = true;
      return fsp.readFile(file, ...args);
    }
  } });
  await expectCode(boundary(harness.inputPath, options(harness, async (_file, args) => {
    await fsp.writeFile(path.join(args[4], "manifest.json"), "{}");
  }), async () => {}), "PDF_STRUCTURE_RESOURCE_LIMIT");
  assert.equal(manifestRead, false);
});

test("model-map escapes and missing inference graphs are rejected", async (t) => {
  const harness = await createHarness(t);
  await fsp.writeFile(path.join(harness.modelDirectory, "model-map.json"), JSON.stringify({ text_detection: "../private" }));
  assert.equal((await getStructuredPdfAvailability(harness)).errorCode, "PDF_STRUCTURE_MODEL_MISSING");
  await fsp.rm(path.join(harness.modelDirectory, "model-map.json"));
  await fsp.rename(path.join(harness.modelDirectory, "text_detection", "inference.json"), path.join(harness.modelDirectory, "text_detection", "inference.pdmodel"));
  assert.equal((await getStructuredPdfAvailability(harness)).enabled, true);
  await fsp.rm(path.join(harness.modelDirectory, "text_detection", "inference.pdmodel"));
  assert.equal((await getStructuredPdfAvailability(harness)).enabled, false);
});

test("501 pages and an oversized single page fail before native launch", async (t) => {
  const harness = await createHarness(t);
  for (const [pages, size] of [[501, [10, 10]], [1, [4000, 4000]], [1, [9000, 10]]]) {
    const pdf = await require("pdf-lib").PDFDocument.create();
    for (let number = 0; number < pages; number += 1) pdf.addPage(size);
    await fsp.writeFile(harness.inputPath, await pdf.save());
    let called = false;
    await expectCode(withStructuredPdf(harness.inputPath, options(harness, async () => { called = true; }), async () => {}), "PDF_STRUCTURE_RESOURCE_LIMIT");
    assert.equal(called, false);
  }
});

test("51 A4 pages retain every page, text, table and colliding asset name across bounded native batches", async (t) => {
  const harness = await createHarness(t);
  const { PDFDocument } = require("pdf-lib");
  const pdf = await PDFDocument.create();
  for (let number = 1; number <= 51; number += 1) {
    pdf.addPage([595, 842]).drawText(`SHEET ${number} AMOUNT ${number}.25`);
  }
  await fsp.writeFile(harness.inputPath, await pdf.save());
  const original = await fsp.readFile(harness.inputPath);
  let active = 0;
  const batchCounts = [];
  const runner = async (_engine, args) => {
    active += 1;
    assert.equal(active, 1, "only one expensive native process may run at a time");
    try {
      const { loadPdfjs } = require("../src/pdfjs");
      const pdfjs = await loadPdfjs();
      const task = pdfjs.getDocument({ data: new Uint8Array(await fsp.readFile(args[2])), isEvalSupported: false });
      const batch = await task.promise;
      batchCounts.push(batch.numPages);
      const manifest = validManifest();
      manifest.pages = [];
      try {
        for (let number = 1; number <= batch.numPages; number += 1) {
          const page = await batch.getPage(number);
          const text = (await page.getTextContent()).items.map(item => item.str).join('');
          const referenceImage = `page-${number}.png`;
          const asset = `asset-${number}.png`;
          await fsp.writeFile(path.join(args[4], referenceImage), text);
          await fsp.writeFile(path.join(args[4], asset), `ASSET ${text}`);
          manifest.pages.push({ pageNumber: number, width: 1190, height: 1684, rotation: 0,
            referenceImage, blocks: [{ type: "table", tableId: `table-${number}`, bbox: [0, 0, 100, 100], confidence: 1 },
              { type: "figure", asset, bbox: [0, 100, 100, 200], confidence: 1 }],
            tables: [{ id: `table-${number}`, bbox: [0, 0, 100, 100], confidence: 1, rowCount: 1, columnCount: 1,
              cells: [{ row: 0, column: 0, rowSpan: 1, columnSpan: 1, bbox: [0, 0, 100, 100], confidence: 1, text }] }] });
          page.cleanup();
        }
      } finally { await task.destroy(); }
      assert.ok(batch.numPages * 2003960 <= 100000000, "each unchanged 144 DPI batch must respect the native pixel budget");
      await fsp.writeFile(path.join(args[4], "manifest.json"), JSON.stringify(manifest));
    } finally { active -= 1; }
  };
  await withStructuredPdf(harness.inputPath, { ...harness, execFile: runner }, async (manifest, assetRoot) => {
    const { resolveStructureAsset } = require("../src/pdf-structure-contract");
    assert.equal(manifest.pages.length, 51);
    for (let index = 0; index < 51; index += 1) {
      const page = manifest.pages[index];
      const expected = `SHEET ${index + 1} AMOUNT ${index + 1}.25`;
      assert.equal(page.pageNumber, index + 1);
      assert.equal(page.tables[0].cells[0].text, expected);
      assert.equal(page.blocks[0].tableId, page.tables[0].id);
      assert.equal(await fsp.readFile(resolveStructureAsset(assetRoot, page.referenceImage), 'utf8'), expected);
      assert.equal(await fsp.readFile(resolveStructureAsset(assetRoot, page.blocks[1].asset), 'utf8'), `ASSET ${expected}`);
    }
    assert.equal(new Set(manifest.pages.map(page => page.referenceImage)).size, 51);
    assert.equal(Object.isFrozen(manifest), true);
  });
  assert.deepEqual(batchCounts, [8, 8, 8, 8, 8, 8, 3]);
  assert.deepEqual(await fsp.readFile(harness.inputPath), original);
  assert.deepEqual(await fsp.readdir(harness.runtimeDir), []);
});

test("large valid pages hit the unchanged pixel budget before the eight-page work bound", async t => {
  const harness = await createHarness(t);
  const pdf = await require("pdf-lib").PDFDocument.create();
  for (let index = 0; index < 3; index += 1) pdf.addPage([3000, 3000]);
  await fsp.writeFile(harness.inputPath, await pdf.save());
  const plan = await preflightStructuredPdf(harness.inputPath);
  assert.equal(plan.pageCount, 3);
  assert.equal(plan.totalPixels, 108000000);
  assert.deepEqual(plan.batches, [
    { startPage: 1, endPage: 2, totalPixels: 72000000 },
    { startPage: 3, endPage: 3, totalPixels: 36000000 }
  ]);
});

test("production defaults fail closed when no engine is configured", async () => {
  const boundary = createStructuredPdfBoundary({
    defaultEnginePath: "",
    defaultModelDirectory: ""
  });
  await expectCode(boundary("ignored.pdf", {}, async () => {}), "PDF_STRUCTURE_ENGINE_MISSING");
});

async function smallBatches(t, pages = 2) {
  const harness = await createHarness(t);
  const pdf = await require("pdf-lib").PDFDocument.create();
  for (let number = 1; number <= pages; number += 1) pdf.addPage([100, 100]).drawText(`PAGE ${number}`, { size: 10 });
  await fsp.writeFile(harness.inputPath, await pdf.save());
  return { ...harness, maxBatchPixels: 40000 };
}

async function writeBatchManifest(args, mutate = () => {}) {
  const manifest = validManifest();
  mutate(manifest);
  await fsp.writeFile(path.join(args[4], "page-001.png"), "reference");
  await fsp.writeFile(path.join(args[4], "manifest.json"), JSON.stringify(manifest));
}

test("structured progress advances only after each native batch passes validation", async t => {
  const harness = await smallBatches(t);
  const events = [];
  let calls = 0;
  await withConversionProgress({ report: event => events.push(event) }, () => withStructuredPdf(harness.inputPath, {
    ...harness, execFile: async (_file, args) => {
      assert.equal(events.filter(event => event.stage === "recognizing").at(-1).completed, calls);
      calls++;
      await writeBatchManifest(args);
    }
  }, async () => { assert.deepEqual(events.at(-1), { stage: "converting" }); }));
  assert.deepEqual(events.filter(event => event.stage === "recognizing").map(event => [event.completed, event.total]), [[0, 2], [1, 2], [2, 2]]);
  assert.ok(!events.some(event => ["succeeded", "completed"].includes(event.stage)));
});

test("a rejected native batch never reports its pages complete", async t => {
  const harness = await smallBatches(t);
  const events = [];
  await expectCode(withConversionProgress({ report: event => events.push(event) }, () => withStructuredPdf(harness.inputPath, {
    ...harness, execFile: async (_file, args) => writeBatchManifest(args, manifest => { manifest.pages = []; })
  }, async () => assert.fail("invalid result consumed"))), "PDF_STRUCTURE_SCHEMA_INVALID");
  assert.deepEqual(events.filter(event => event.stage === "recognizing").map(event => event.completed), [0]);
});

for (const defect of ["missing", "duplicate", "escaped asset"]) {
  test(`a ${defect} page in a later batch rejects the entire document and cleans scratch`, async t => {
    const harness = await smallBatches(t);
    let calls = 0, consumed = false;
    await expectCode(withStructuredPdf(harness.inputPath, { ...harness, execFile: async (_file, args) => {
      calls += 1;
      await writeBatchManifest(args, manifest => {
        if (calls !== 2) return;
        if (defect === "missing") manifest.pages = [];
        if (defect === "duplicate") manifest.pages.push({ ...manifest.pages[0] });
        if (defect === "escaped asset") manifest.pages[0].referenceImage = "../batch-001/page-001.png";
      });
    } }, async () => { consumed = true; }), "PDF_STRUCTURE_SCHEMA_INVALID");
    assert.equal(calls, 2);
    assert.equal(consumed, false);
    assert.deepEqual(await fsp.readdir(harness.runtimeDir), []);
  });
}

test("unreferenced output bytes count across batches before another native process starts", async t => {
  const harness = await smallBatches(t, 3);
  const boundary = createStructuredPdfBoundary({ fileSystem: { ...fsp, async lstat(file) {
    const stats = await fsp.lstat(file);
    if (path.basename(file) === "unreferenced.bin") stats.size = 300 * 1024 * 1024;
    return stats;
  } } });
  let calls = 0;
  await expectCode(boundary(harness.inputPath, { ...harness, execFile: async (_file, args) => {
    calls += 1;
    await writeBatchManifest(args);
    await fsp.writeFile(path.join(args[4], "unreferenced.bin"), "logical large native output");
  } }, async () => assert.fail("must not publish over-budget output")), "PDF_STRUCTURE_RESOURCE_LIMIT");
  assert.equal(calls, 2);
  assert.deepEqual(await fsp.readdir(harness.runtimeDir), []);
});

test("total blocks remain bounded across otherwise valid batches", async t => {
  const harness = await smallBatches(t, 12);
  let calls = 0;
  await expectCode(withStructuredPdf(harness.inputPath, { ...harness, execFile: async (_file, args) => {
    calls += 1;
    await writeBatchManifest(args, manifest => {
      manifest.pages[0].blocks = Array.from({ length: 5000 }, () =>
        ({ type: "text", text: "X", bbox: [0, 0, 10, 10], confidence: 1 }));
    });
  } }, async () => assert.fail("must not publish over-budget content")), "PDF_STRUCTURE_RESOURCE_LIMIT");
  assert.equal(calls, 11);
  assert.deepEqual(await fsp.readdir(harness.runtimeDir), []);
});

test("cancellation between native batches prevents the next process and consumer", async t => {
  const harness = await smallBatches(t);
  const controller = new AbortController();
  let calls = 0;
  await expectCode(withStructuredPdf(harness.inputPath, { ...harness, signal: controller.signal,
    execFile: async (_file, args) => {
      calls += 1;
      await writeBatchManifest(args);
      controller.abort();
    } }, async () => assert.fail("canceled output must not be consumed")), "CONVERSION_CANCELED");
  assert.equal(calls, 1);
  assert.deepEqual(await fsp.readdir(harness.runtimeDir), []);
});

test("native temporary files stay in a task-owned directory that is cleaned on cancellation", async t => {
  const harness = await smallBatches(t);
  const controller = new AbortController();
  let nativeScratch;
  await expectCode(withStructuredPdf(harness.inputPath, { ...harness, signal: controller.signal,
    execFile: async (_file, args, processOptions) => {
      nativeScratch = processOptions.env.TEMP;
      assert.equal(processOptions.env.TMP, nativeScratch);
      assert.equal(processOptions.env.TMPDIR, nativeScratch);
      assert.equal(path.dirname(nativeScratch), harness.runtimeDir);
      assert.notEqual(nativeScratch, args[4]);
      await fsp.mkdir(path.join(nativeScratch, "flyingmouse-paddlex-test"));
      await fsp.writeFile(path.join(nativeScratch, "flyingmouse-paddlex-test", "config.json"), "native configuration");
      controller.abort();
    } }, async () => assert.fail("must not consume canceled native output")), "CONVERSION_CANCELED");
  await assert.rejects(fsp.access(nativeScratch));
  assert.deepEqual(await fsp.readdir(harness.runtimeDir), []);
});

test("cancellation stops a real native-boundary direct child before scratch is cleaned", async t => {
  const harness = await smallBatches(t);
  const controller = new AbortController();
  let pid, childClosed = false;
  const boundary = createStructuredPdfBoundary({ fileSystem: { ...fsp, async rm(file, options) {
    if (path.basename(file).startsWith("fm-pdf-structure-")) assert.equal(childClosed, true);
    return fsp.rm(file, options);
  } } });
  await expectCode(boundary(harness.inputPath, { ...harness, signal: controller.signal,
    execFile: async (_file, _args, processOptions) => {
      assert.equal(processOptions.signal, controller.signal);
      const run = realExecFile(process.execPath, ["-e", "setInterval(() => {}, 1000)"], processOptions);
      pid = run.child.pid;
      const closed = new Promise(resolve => run.child.once("close", () => { childClosed = true; resolve(); }));
      setTimeout(() => controller.abort(), 80);
      try { return await run; } finally { await closed; }
    } }, async () => assert.fail("canceled output must not be consumed")), "CONVERSION_CANCELED");
  assert.ok(pid);
  assert.throws(() => process.kill(pid, 0), error => error.code === "ESRCH");
  assert.deepEqual(await fsp.readdir(harness.runtimeDir), []);
});

test("copied batches preserve page boxes, rotation, UserUnit, text and annotation appearance", async t => {
  const harness = await createHarness(t);
  const { PDFDocument, PDFName, PDFNumber, degrees } = require("pdf-lib");
  const source = await PDFDocument.create();
  for (let number = 1; number <= 2; number += 1) {
    const page = source.addPage([320, 240]);
    page.setCropBox(10, 15, 290, 210);
    page.setRotation(degrees(90));
    page.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
    page.drawText(`AMOUNT ${number}234.56`, { x: 25, y: 100, size: 18 });
    const appearance = source.context.flateStream("0 0 1 rg 0 0 25 12 re f", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 25, 12] });
    page.node.addAnnot(source.context.register(source.context.obj({ Type: "Annot", Subtype: "Stamp", Rect: [30, 30, 55, 42],
      AP: { N: source.context.register(appearance) } })));
  }
  await fsp.writeFile(harness.inputPath, await source.save());
  const { loadPdfjs } = require("../src/pdfjs");
  const pdfjs = await loadPdfjs();
  async function inspect(file) {
    const loading = pdfjs.getDocument({ data: new Uint8Array(await fsp.readFile(file)), isEvalSupported: false });
    const pdf = await loading.promise;
    const pages = [];
    try {
      for (let index = 1; index <= pdf.numPages; index += 1) {
        const page = await pdf.getPage(index);
        const viewport = page.getViewport({ scale: 2 });
        pages.push({ view: page.view, rotation: page.rotate, userUnit: page.userUnit, width: viewport.width, height: viewport.height,
          text: (await page.getTextContent()).items.map(item => item.str).join(""),
          annotations: (await page.getAnnotations()).map(item => ({ subtype: item.subtype, rect: item.rect, hasAppearance: item.hasAppearance })) });
      }
    } finally { await loading.destroy(); }
    return pages;
  }
  const expected = await inspect(harness.inputPath);
  const observed = [];
  await withStructuredPdf(harness.inputPath, { ...harness, maxBatchPixels: 1, execFile: async (_file, args) => {
    observed.push(...await inspect(args[2]));
    await writeBatchManifest(args);
  } }, async () => {});
  assert.deepEqual(observed, expected);
  assert.equal(observed[0].annotations[0].hasAppearance, true);
});

test("batched pages keep catalog optional-content visibility and form settings", async t => {
  const harness = await createHarness(t);
  const { PDFDocument, PDFName } = require("pdf-lib");
  const source = await PDFDocument.create();
  const group = source.context.register(source.context.obj({ Type: "OCG", Name: "Hidden source layer" }));
  source.catalog.set(PDFName.of("OCProperties"), source.context.obj({ OCGs: [group],
    D: { BaseState: "ON", OFF: [group], Order: [group] } }));
  source.catalog.set(PDFName.of("AcroForm"), source.context.obj({ Fields: [], NeedAppearances: false }));
  for (let number = 0; number < 2; number += 1) {
    const page = source.addPage([100, 100]);
    page.node.set(PDFName.of("Resources"), source.context.obj({ Properties: { Hidden: group } }));
    page.node.set(PDFName.of("Contents"), source.context.register(source.context.flateStream("/OC /Hidden BDC 0 0 20 20 re f EMC")));
  }
  await fsp.writeFile(harness.inputPath, await source.save());
  const pdfjs = await require("../src/pdfjs").loadPdfjs();
  await withStructuredPdf(harness.inputPath, { ...harness, maxBatchPixels: 40000, execFile: async (_file, args) => {
    const bytes = await fsp.readFile(args[2]);
    const copied = await PDFDocument.load(bytes);
    assert.ok(copied.catalog.get(PDFName.of("AcroForm")), "catalog form settings must survive batching");
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false });
    try {
      const pdf = await task.promise;
      const config = await pdf.getOptionalContentConfig();
      const groups = Array.from(config, ([id, group]) => ({ id, visible: group.visible }));
      assert.equal(groups.length, 1);
      assert.equal(groups[0].visible, false, "hidden source content must stay hidden for recognition");
    } finally { await task.destroy(); }
    await writeBatchManifest(args);
  } }, async () => {});
});

for (const method of ["mkdir", "mkdtemp"]) {
  test(`redacts ${method} workspace setup failures`, async (t) => {
    const harness = await createHarness(t);
    const fileSystem = Object.create(fsp);
    fileSystem[method] = async () => { throw new Error("private scratch path"); };
    const boundary = createStructuredPdfBoundary({ fileSystem });
    await expectCode(
      boundary(harness.inputPath, options(harness, async () => {}), async () => {}),
      "PDF_STRUCTURE_PARSE_FAILED"
    );
  });
}

test("rejects symlinked engine and model roots before spawning", async (t) => {
  const harness = await createHarness(t);
  const fileSystem = Object.create(fsp);
  fileSystem.lstat = async (candidate) => {
    const stats = await fsp.lstat(candidate);
    return candidate === harness.enginePath || candidate === harness.modelDirectory
      ? { ...stats, isSymbolicLink: () => true }
      : stats;
  };
  const boundary = createStructuredPdfBoundary({ fileSystem });
  let spawned = false;
  await expectCode(boundary(harness.inputPath, options(harness, () => { spawned = true; }), async () => {}), "PDF_STRUCTURE_ENGINE_MISSING");
  const modelOnlyFileSystem = Object.create(fsp);
  modelOnlyFileSystem.lstat = async (candidate) => {
    const stats = await fsp.lstat(candidate);
    return candidate === harness.modelDirectory
      ? { ...stats, isSymbolicLink: () => true }
      : stats;
  };
  const modelBoundary = createStructuredPdfBoundary({ fileSystem: modelOnlyFileSystem });
  await expectCode(modelBoundary(harness.inputPath, options(harness, () => { spawned = true; }), async () => {}), "PDF_STRUCTURE_MODEL_MISSING");
  assert.equal(spawned, false);
});

test("rejects a missing manifest", async (t) => {
  const harness = await createHarness(t);
  await expectCode(withStructuredPdf(harness.inputPath, options(harness, async () => {}), async () => {}), "PDF_STRUCTURE_PARSE_FAILED");
});

test("rejects malformed manifest JSON", async (t) => {
  const harness = await createHarness(t);
  await expectCode(withStructuredPdf(harness.inputPath, options(harness, async (_file, args) => {
    await fsp.writeFile(path.join(args[4], "manifest.json"), "{private OCR");
  }), async () => {}), "PDF_STRUCTURE_SCHEMA_INVALID");
});

test("maps validator failures to a stable schema error", async (t) => {
  const harness = await createHarness(t);
  const runOptions = options(harness, async (_file, args) => {
    await fsp.writeFile(path.join(args[4], "manifest.json"), JSON.stringify(validManifest()));
  }, () => { throw new Error("private asset path"); });
  await expectCode(withStructuredPdf(harness.inputPath, runOptions, async () => {}), "PDF_STRUCTURE_SCHEMA_INVALID");
});

test("keeps assets alive through the callback then cleans the private directory", async (t) => {
  const harness = await createHarness(t);
  let scratch;
  const runOptions = options(harness, async (_file, args) => {
    scratch = args[4];
    await fsp.writeFile(path.join(scratch, "page-001.png"), "asset");
    await fsp.writeFile(path.join(scratch, "manifest.json"), JSON.stringify(validManifest()));
  });
  await assert.rejects(withStructuredPdf(harness.inputPath, runOptions, async (_manifest, assetRoot) => {
    assert.equal(assetRoot, scratch);
    assert.equal(await fsp.readFile(path.join(assetRoot, "page-001.png"), "utf8"), "asset");
    throw new Error("consumer failed");
  }), /consumer failed/);
  await assert.rejects(fsp.access(scratch));
  assert.deepEqual(await fsp.readdir(harness.runtimeDir), []);
});

test("reports a stable cleanup failure after a successful consumer", async (t) => {
  const harness = await createHarness(t);
  const fileSystem = Object.create(fsp);
  fileSystem.rm = async () => { throw new Error("private scratch path"); };
  const boundary = createStructuredPdfBoundary({ fileSystem });
  await expectCode(boundary(harness.inputPath, options(harness, async (_file, args) => {
    await fsp.writeFile(path.join(args[4], "manifest.json"), JSON.stringify(validManifest()));
  }), async () => "ok"), "PDF_STRUCTURE_PARSE_FAILED");
});

test("preserves a consumer failure when cleanup also fails", async (t) => {
  const harness = await createHarness(t);
  const fileSystem = Object.create(fsp);
  fileSystem.rm = async () => { throw new Error("private scratch path"); };
  const boundary = createStructuredPdfBoundary({ fileSystem });
  const consumerError = new Error("consumer failed");
  await assert.rejects(boundary(harness.inputPath, options(harness, async (_file, args) => {
    await fsp.writeFile(path.join(args[4], "manifest.json"), JSON.stringify(validManifest()));
  }), async () => { throw consumerError; }), (error) => error === consumerError);
});
