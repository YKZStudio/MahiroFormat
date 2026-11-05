const assert = require("node:assert/strict");
const { test } = require("node:test");
const { run, targetsForExt, normalizeExt } = require("../src/utils");

test("verbose successful conversions keep a bounded stderr tail without being killed", async () => {
  const result = await run(process.execPath, ["-e", "process.stderr.write('x'.repeat(1200000)+'END');process.stdout.write('RESULT')"]);
  assert.equal(result.stdout, "RESULT");
  assert.ok(result.stderr.endsWith("END"));
  assert.ok(Buffer.byteLength(result.stderr) <= 128 * 1024);
  assert.equal(result.stderrTruncated, true);
});

test("subprocess failures preserve exit status and missing executable error code", async () => {
  await assert.rejects(run(process.execPath, ["-e", "process.stderr.write('conversion failed');process.exit(42)"]), error => error.code === 42 && /conversion failed/.test(error.message));
  await assert.rejects(run("flyingmouse-nonexistent-executable", []), error => error.code === "ENOENT");
});

test("subprocess timeout and stdout budget reject explicitly", async () => {
  await assert.rejects(run(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeout: 50 }), error => error.code === "ETIMEDOUT");
  await assert.rejects(run(process.execPath, ["-e", "process.stdout.write('x'.repeat(10000))"], { maxStdoutBytes: 1024 }), error => error.code === "PROCESS_OUTPUT_LIMIT");
});

test("pure JS document routes remain usable without LibreOffice and JPEG aliases normalize", () => {
  assert.ok(targetsForExt("docx", {}).includes("md"));
  assert.ok(targetsForExt("docx", {}).includes("txt"));
  assert.ok(!targetsForExt("doc", {}).includes("pdf"));
  assert.equal(normalizeExt("jfif"), "jpg");
  assert.equal(normalizeExt("jpe"), "jpg");
});

test("process observers receive real stream chunks before completion without changing output", async () => {
  let completed = false;
  const observed = { stdout: [], stderr: [] };
  const result = await run(process.execPath, ["-e", "process.stdout.write('first');process.stderr.write('status');setTimeout(()=>process.stdout.write('last'),100)"], {
    onStdout: chunk => { assert.equal(completed, false); observed.stdout.push(chunk.toString()); },
    onStderr: chunk => { assert.equal(completed, false); observed.stderr.push(chunk.toString()); }
  }).then(value => { completed = true; return value; });
  assert.equal(observed.stdout.join(""), "firstlast");
  assert.equal(observed.stderr.join(""), "status");
  assert.equal(result.stdout, "firstlast");
  assert.equal(result.stderr, "status");
});

test("a throwing progress observer does not fail a successful native conversion", async () => {
  let calls = 0;
  const result = await run(process.execPath, ["-e", "process.stdout.write('result')"], {
    onStdout: () => { calls++; throw new Error("observer only"); }
  });
  assert.equal(calls, 1);
  assert.equal(result.stdout, "result");
});

test("observer buffer mutation and rejected promises cannot corrupt output or become unhandled", async () => {
  let calls = 0;
  const result = await run(process.execPath, ["-e", "process.stdout.write('original')"], {
    onStdout: async chunk => { calls++; chunk.fill(0); throw new Error("async observer only"); }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(result.stdout, "original");
});
