const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { defaultExecutor } = require("../src/office-process");

function isRunning(pid) {
  try { process.kill(pid, 0); }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
  if (process.platform === "win32") return true;
  // An orphan killed with its group may remain a zombie until init reaps it.
  // kill(pid, 0) alone incorrectly counts that already-dead process as running.
  const state = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
  assert.ifError(state.error);
  assert.ok(state.status === 0 || state.status === 1, state.stderr);
  return Boolean(state.stdout.trim()) && !state.stdout.trim().startsWith("Z");
}

async function assertStopped(pid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!isRunning(pid)) return;
    await delay(30);
  }
  assert.fail(`Owned process ${pid} remained running after cleanup`);
}

function cleanFixture(root, pidFile) {
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    try { if (isRunning(pid)) process.kill(pid, "SIGKILL"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  fs.rmSync(root, { recursive: true, force: true });
}

test("timeout terminates this invocation's descendants and preserves an unrelated process", { timeout: 15000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fm-proc-"));
  const pidFile = path.join(root, "child.pid");
  t.after(() => cleanFixture(root, pidFile));
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "ignore" });
  t.after(() => unrelated.kill());
  const script = `const child = require('node:child_process').spawn(process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'inherit' });
    require('node:fs').writeFileSync(process.argv[1], String(child.pid)); setInterval(() => {}, 1000);`;
  await assert.rejects(defaultExecutor(process.execPath, ["-e", script, pidFile], { timeout: 1500 }),
    (error) => error.code === "ETIMEDOUT" && error.timedOut === true && error.treeTerminated === true);
  const descendant = Number(fs.readFileSync(pidFile, "utf8"));
  await assertStopped(descendant);
  assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
});

test("successful execution returns captured diagnostics and leaves no timeout", async () => {
  const result = await defaultExecutor(process.execPath, ["-e", "process.stdout.write('ok');process.stderr.write('warning')"], { timeout: 5000 });
  assert.equal(result.stdout, "ok");
  assert.equal(result.stderr, "warning");
});

test("failed execution retains exit code and both diagnostic streams", async () => {
  await assert.rejects(defaultExecutor(process.execPath, ["-e",
    "process.stdout.write('details');process.stderr.write('failure');process.exitCode=7"], { timeout: 5000 }),
  (error) => error.code === 7 && error.stdout === "details" && error.stderr === "failure" && !error.timedOut);
});

test("spawn failure rejects promptly with the original error", async () => {
  await assert.rejects(defaultExecutor(path.join(os.tmpdir(), `missing-office-${process.pid}-${Date.now()}`), [], { timeout: 5000 }),
    (error) => error.code === "ENOENT" && error.stdout === "" && error.stderr === "" && !error.timedOut);
});

for (const stream of ["stdout", "stderr"]) {
  test(`${stream} exceeding 1 MiB is bounded and terminates the child`, { timeout: 15000 }, async () => {
    let childPid;
    await assert.rejects(defaultExecutor(process.execPath, ["-e",
      `process.${stream}.write('x'.repeat(1024 * 1024 + 512));setInterval(() => {}, 1000)`], { timeout: 5000 }),
    (error) => {
      childPid = error.childPid;
      assert.equal(error.code, "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
      assert.equal(error.stream, stream);
      assert.equal(error.treeTerminated, true);
      assert.equal(Buffer.byteLength(error[stream]), 1024 * 1024);
      return true;
    });
    await assertStopped(childPid);
  });
}

test("POSIX timeout kills a descendant retaining pipes after its launcher exits", {
  skip: process.platform === "win32", timeout: 15000
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fm-proc-orphan-"));
  const pidFile = path.join(root, "child.pid");
  t.after(() => cleanFixture(root, pidFile));
  const script = `const child = require('node:child_process').spawn(process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
    require('node:fs').writeFileSync(process.argv[1], String(child.pid)); child.unref();`;
  await assert.rejects(defaultExecutor(process.execPath, ["-e", script, pidFile], { timeout: 1500 }),
    (error) => error.code === "ETIMEDOUT" && error.treeTerminated === true);
  await assertStopped(Number(fs.readFileSync(pidFile, "utf8")));
});
