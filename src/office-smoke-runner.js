// Store preparation intentionally runs its synchronous filesystem transaction in
// a Worker. This helper keeps native execution asynchronous so its deadline can
// terminate the soffice launcher AND its child instead of orphaning the dialog.
const { defaultExecutor } = require("./office-process");

async function main() {
  const { command, args, timeout } = JSON.parse(process.argv[2]);
  try {
    await defaultExecutor(command, args, { timeout });
  } catch (error) {
    process.stderr.write(JSON.stringify({ code: error.code || "OFFICE_ENGINE_START_FAILED",
      timedOut: Boolean(error.timedOut), treeTerminated: error.treeTerminated ?? null,
      childPid: error.childPid || null,
      cleanupError: error.cleanupError || null,
      stdout: String(error.stdout || "").slice(-4096), stderr: String(error.stderr || "").slice(-4096) }));
    process.exitCode = 1;
  }
}

main().catch(error => { process.stderr.write(String(error.message || error)); process.exitCode = 1; });
