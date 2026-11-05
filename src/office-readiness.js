// Office initialization is independent of the HTTP server and desktop window.
// The destination is fixed before config.js is loaded; only actual Office work waits.
const MESSAGES = {
  zhCN: "Office 转换引擎准备失败。请检查系统盘剩余空间、用户目录写入权限和安全软件拦截，重新启动后重试；仍失败时请导出诊断报告。",
  enUS: "The Office engine could not be prepared. Check free space on the system drive, user-folder permissions and security software, then restart. Export diagnostics if the problem continues."
};

class OfficePreparationError extends Error {
  constructor(reason) {
    super(MESSAGES.zhCN);
    this.name = "OfficePreparationError";
    this.code = "OFFICE_ENGINE_PREPARATION_FAILED";
    this.messages = MESSAGES;
    this.details = { reason: String(reason || "Unknown preparation failure") };
  }
}

function createOfficeReadiness() {
  let state = { status: "ready" };
  let prepare;
  let pending = Promise.resolve();
  let resolvePending;
  let started = false;

  function configureOfficePreparation(options) {
    if (state.status === "pending") throw new Error("Office preparation already configured");
    prepare = options.prepare;
    started = false;
    state = { status: "pending", path: options.path };
    // This promise always settles successfully; errors are retained in state so
    // a failure without an active conversion cannot become an unhandled rejection.
    pending = new Promise((resolve) => { resolvePending = resolve; });
  }

  function startOfficePreparation() {
    if (started || state.status !== "pending") return pending;
    started = true;
    Promise.resolve().then(prepare).then((result) => {
      if (!result || !["cache", "published"].includes(result.source) || result.path !== state.path) {
        throw new OfficePreparationError(result?.reason || "Engine preparation returned no verified writable engine");
      }
      state = { status: "ready", path: result.path, source: result.source };
    }).catch((error) => {
      state = { status: "failed", path: state.path,
        error: error instanceof OfficePreparationError ? error : new OfficePreparationError(error?.message || error) };
    }).finally(() => resolvePending());
    return pending;
  }

  async function waitForOfficeReady() {
    await pending;
    if (state.status === "failed") throw state.error;
    return getOfficeState();
  }

  function getOfficeState() { return { ...state }; }
  return { configureOfficePreparation, startOfficePreparation, waitForOfficeReady, getOfficeState };
}

module.exports = { ...createOfficeReadiness(), createOfficeReadiness, OfficePreparationError };
