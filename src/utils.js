// utils.js — Mahiro Format 服务端通用工具：进程执行、文件名/格式处理、输出命名。
// 第一批抽取自 server.js（零逻辑改动，纯搬移）。

const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const sanitize = require("sanitize-filename");
const logger = require("./logger");
const ownedTasks = require("./owned-tasks");
const { cancellationError } = require("./conversion-cancellation");
const {
  OUTPUT_DIR,
  imageInput,
  designInput,
  rawInput,
  imageFormatTargets,
  imageVideoTargets,
  imageOcrTargets,
  textInput,
  textTargets,
  documentInput,
  documentTargets,
  ofdOnlyPdfTargets,
  spreadsheetInput,
  spreadsheetTargets,
  presentationInput,
  presentationTargets,
  pdfInput,
  pdfTextTargets,
  pdfImageTargets,
  subtitleInput,
  subtitleTargets,
  audioInput,
  unlockAudioInputs,
  videoInput,
  mediaAudioTargets,
  mediaVideoTargets,
  mediaTargets,
  experimentalInputSet,
  downloads
} = require("./config");

function ensureDirs() {
  fs.mkdirSync(require("./config").UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    ownedTasks.assertAccepting();
    if (options.signal?.aborted) { reject(cancellationError()); return; }
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    ownedTasks.trackProcess(child);
    // EOF through a pipe avoids libuv opening the Windows NUL device.
    child.stdin?.on("error", () => {});
    child.stdin?.end();
    const stdoutLimit = options.maxStdoutBytes || 16 * 1024 * 1024;
    const stderrLimit = 128 * 1024;
    const stdoutChunks = [];
    let stdoutBytes = 0;
    let stderr = Buffer.alloc(0);
    let stderrTruncated = false;
    let failure = null;
    let settled = false;
    const failedObservers = new Set();
    function observerFailed(name) {
      if (failedObservers.has(name)) return;
      failedObservers.add(name);
      logger.warn("Conversion progress observer failed.");
    }
    function observe(name, chunk) {
      if (failure || settled || failedObservers.has(name) || typeof options[name] !== "function") return;
      try {
        const result = options[name](Buffer.from(chunk));
        if (result && typeof result.then === "function") Promise.resolve(result).catch(() => observerFailed(name));
      } catch {
        // Progress is diagnostic only. Never let a listener exception escape
        // the stream event or change native success/output-limit semantics.
        observerFailed(name);
      }
    }
    const abort = () => { failure = cancellationError(); child.kill(); };
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      failure = Object.assign(new Error("Conversion process timed out."), { code: "ETIMEDOUT" });
      child.kill();
    }, options.timeout || 1000 * 60 * 15);
    function complete(code, signal) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      const output = { stdout: Buffer.concat(stdoutChunks).toString("utf8"), stderr: stderr.toString("utf8"), stderrTruncated };
      if (failure || code !== 0) {
        const error = failure || Object.assign(new Error(output.stderr.trim() || `Conversion process exited with code ${code}.`), { code });
        error.signal = signal || null;
        error.stderr = output.stderr;
        // Arguments can contain passwords; never serialize them into diagnostics.
        logger.warn(`Command failed: ${path.basename(String(command))}`, { code: error.code, signal: error.signal });
        reject(error);
      } else resolve(output);
    }
    child.on("error", error => { failure = error; complete(error.code, null); });
    child.stdout.on("data", chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > stdoutLimit) {
        failure = Object.assign(new Error("Conversion process output exceeded the supported size."), { code: "PROCESS_OUTPUT_LIMIT" });
        child.kill();
      } else {
        stdoutChunks.push(chunk);
        observe("onStdout", chunk);
      }
    });
    child.stderr.on("data", chunk => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > stderrLimit) { stderr = stderr.subarray(stderr.length - stderrLimit); stderrTruncated = true; }
      observe("onStderr", chunk);
    });
    child.on("close", complete);
  });
}

async function commandExists(command, versionArgs = ["-version"]) {
  try {
    await run(command, versionArgs, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function extFromName(name = "") {
  return path.extname(String(name || "")).replace(".", "").toLowerCase();
}

function decodeUploadFileName(name = "") {
  const original = String(name || "file");

  // UTF-8 mojibake：浏览器/Electron 的 FormData 用 UTF-8 编码文件名，
  // multer 的 busboy 按 latin1 解码后会出现 Ã© 这类字符，还原回 UTF-8。
  // 解码成功直接返回，不再往下走 GBK（避免把正确中文名二次转换）。
  // 判据改为「latin1→utf8 解码后无 U+FFFD 且 ≠ 原串」：不再用字符白名单，
  // 因此对所有多字节字符集都成立——中文、日文、韩文、阿拉伯文、俄文、emoji
  // 全能被还原（2026-08-31 实测：旧白名单漏掉韩文/阿文，出现 íêµ­ì´Ø§Ù 乱码），
  // 而真正的 GBK 内容解码必产生 U+FFFD，会正确落回下面的 GBK 分支。
  try {
    const decoded = Buffer.from(original, "latin1").toString("utf8");
    const hasHighByte = [...original].some((ch) => ch.charCodeAt(0) >= 0x80);
    // 组合变音符号（U+0300–U+036F 等）：GBK 字节如 0xD6D0 0xCEC4（"中文"）恰好同时是
    // 合法 UTF-8（解出希伯来字母+组合音标），无此护栏会把 GBK 内容错误吞进 UTF-8 分支。
    const combiningMarks = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/;
    if (hasHighByte && decoded && decoded !== original && !decoded.includes("\uFFFD") && !combiningMarks.test(decoded)) {
      return decoded;
    }
  } catch {
    // fall through to GBK attempt
  }

  // GBK mojibake：命令行/某些上传场景（curl -F filename、微信传输文件名、老
  // 客户端）会用系统代码页（中文 Windows = GBK/936）编码文件名，multer 按
  // latin1 解码后出现 °×À¼µÄ 这类字符（2026-08-14 实测：中文文件名上传返回
  // 乱码）。护栏：只有「高字节成对相邻」时才尝试 GBK。真正的 GBK 中文名每个汉字占两个
  // ≥0x80 字节，必然出现相邻高字节；真 latin1 西欧名里高字节是孤立的（前后都是
  // ASCII 字母），无此护栏时 0xF8 0x72（ø + r）恰好是合法 GBK 序列，
  // Bjørn Åsnes.flac 会被错解成 Bj鴕n 舠nes.flac（2026-08-31 实测并修复）。
  if (/[\u0080-\u00ff]{2}/.test(original)) {
    try {
      const bytes = Buffer.from(original, "latin1");
      const decoded = new TextDecoder("gbk").decode(bytes);
      if (decoded && !decoded.includes("\uFFFD") && decoded !== original) {
        return decoded;
      }
    } catch {
      // TextDecoder 不支持 gbk 时原样返回
    }
  }
  return original;
}

function normalizeExt(ext) {
  if (["jpeg", "jfif", "jpe"].includes(ext)) return "jpg";
  if (ext === "markdown") return "md";
  if (ext === "htm") return "html";
  if (ext === "tif") return "tiff";
  return ext;
}

function categoryForExt(rawExt) {
  const ext = normalizeExt(rawExt);
  // designInput（.ai/.psd）归入图片分类：前端/路由与 jpg 等一致，解码在 prepareImageInput 中转。
  if (imageInput.has(ext) || imageInput.has(rawExt) || designInput.has(ext) || rawInput.has(ext) || rawInput.has(rawExt)) return "image";
  if (pdfInput.has(ext) || pdfInput.has(rawExt)) return "pdf";
  if (subtitleInput.has(ext)) return "subtitle";
  if (documentInput.has(ext) || documentInput.has(rawExt)) return "document";
  if (spreadsheetInput.has(ext) || spreadsheetInput.has(rawExt)) return "spreadsheet";
  if (presentationInput.has(ext) || presentationInput.has(rawExt)) return "presentation";
  if (textInput.has(ext) || textInput.has(rawExt)) return "text";
  if (audioInput.has(ext) || audioInput.has(rawExt)) return "audio";
  if (videoInput.has(ext) || videoInput.has(rawExt)) return "video";
  if (ext === "zip") return "zip";
  return "unknown";
}

function targetsForExt(rawExt, tools) {
  if (process.windowsStore && unlockAudioInputs.has(normalizeExt(rawExt))) return [];
  const category = categoryForExt(rawExt);
  const targets = new Set();
  if (category === "subtitle") return subtitleTargets.filter(target => target !== normalizeExt(rawExt));

  if (category === "image") {
    imageFormatTargets.forEach((target) => targets.add(target));
    if (tools.ffmpeg) {
      imageVideoTargets.forEach((target) => targets.add(target));
    }
    if (tools.ocr) {
      imageOcrTargets.forEach((target) => targets.add(target));
    }
  }

  if (category === "text") {
    textTargets.forEach((target) => targets.add(target));
    if (tools.libreoffice && (normalizeExt(rawExt) !== "md" || tools.pandoc)) {
      targets.add("pdf");
    }
    if (["txt", "html"].includes(normalizeExt(rawExt)) || (normalizeExt(rawExt) === "md" && tools.pandoc)) {
      targets.add("docx");
    }
  }

  // Binary ebook targets follow the implemented readers, not text pass-through.
  if (normalizeExt(rawExt) === "epub") {
    return ["txt", "md", "html", ...(tools.libreoffice ? ["pdf", "docx"] : [])];
  }
  if (normalizeExt(rawExt) === "mobi") {
    return [...targets].filter((target) => ["epub", "txt", "md"].includes(target));
  }

  if (category === "pdf") {
    pdfTextTargets.forEach((target) => targets.add(target));
    if (tools.poppler) {
      pdfImageTargets.forEach((target) => targets.add(target));
      targets.add("pdf");
    }
  }

  // OFD 只走自有转换链路（ofd-convert.js → PDF），LibreOffice 打不开 OFD，
  // 提前返回避免 document 分支把 docx/odt/txt 等无效目标加进来。
  if (normalizeExt(rawExt) === "ofd") {
    ofdOnlyPdfTargets.forEach((target) => targets.add(target));
    return [...targets];
  }

  if (category === "document" && tools.libreoffice) {
    documentTargets.forEach((target) => targets.add(target));
  }
  if (normalizeExt(rawExt) === "docx") {
    targets.add("md");
    targets.add("txt");
  }

  if (category === "spreadsheet" && tools.libreoffice) {
    spreadsheetTargets.forEach((target) => targets.add(target));
  }

  if (["csv", "tsv"].includes(normalizeExt(rawExt))) {
    textTargets.forEach((target) => targets.add(target));
    // csv/tsv 的 xlsx/pdf/html/epub 有自有实现（见 /api/convert 分发）；xls/ods 的
    // LO 分隔文本导入在 headless 下假成功（exit 0 零输出），不提供，避免 500。
    // xlsx 用 exceljs 生成，不依赖 LibreOffice（CI 无 LO 环境也必须可用）。
    targets.add("xlsx");
    targets.delete("xls");
    targets.delete("ods");
  }

  if (category === "presentation" && tools.libreoffice) {
    presentationTargets.forEach((target) => targets.add(target));
  }

  if (category === "audio" && tools.ffmpeg) {
    mediaAudioTargets.forEach((target) => targets.add(target));
  }

  if (category === "video" && tools.ffmpeg) {
    mediaTargets.forEach((target) => targets.add(target));
  }

  if (category === "zip") {
    targets.add("pdf");
  }

  return [...targets].filter((target) => {
    const normalizedInput = normalizeExt(rawExt);
    if (category === "pdf" && target === "pdf") return true;
    if (category === "image" && ["gif", "webp"].includes(normalizedInput) && target === "tiff") return false;
    return target !== normalizedInput;
  });
}

function platformCapabilities(platform = process.platform, arch = process.arch) {
  return {
    os: platform,
    arch,
    standardNcm: true,
    av3a: platform === "win32"
  };
}

function experimentalInputWarning(inputExt) {
  return {
    code: "EXPERIMENTAL_INPUT",
    details: { inputFormat: inputExt },
    messages: {
      zhCN: `${inputExt.toUpperCase()} 属于不稳定的实验性兼容功能，尚未覆盖足够真实样本；请保留源文件并复核转换结果。`,
      enUS: `${inputExt.toUpperCase()} support is unstable and experimental with limited real-file validation; keep the source and review the converted result.`
    }
  };
}

function safeBaseName(originalName) {
  const parsed = path.parse(sanitize(originalName || "file"));
  return (parsed.name || "converted").trim().slice(0, 180) || "converted";
}

function outputExtFor(category, targetExt) {
  // PDF/PPT 转图片不再默认 zip：单页直接出图（server 里按页数决定是否回退打包装配）。
  // 旧行为「jpg→jpg.zip」让用户 4 个文件解压出 4 个同名 page-001.jpg（2026-09-08 投诉）。
  if (category === "pdf" && targetExt === "pdf") return "zip";
  if (category === "presentation" && ["png", "jpg", "webp"].includes(targetExt)) return "zip";
  return targetExt;
}

function outputNameFor(originalName, targetExt, outputExt = targetExt) {
  const suffix = outputExt === targetExt ? targetExt : `${targetExt}.${outputExt}`;
  return `${safeBaseName(originalName)}.${suffix}`;
}

function outputPathFor(originalName, targetExt, outputExt = targetExt) {
  return path.join(OUTPUT_DIR, `${Date.now()}-${randomUUID()}-${outputNameFor(originalName, targetExt, outputExt)}`);
}

function previewKindFor(downloadName, mimeType) {
  const ext = normalizeExt(extFromName(downloadName));
  if (subtitleInput.has(ext)) return "text";
  if (String(mimeType).startsWith("image/")) return "image";
  if (mimeType === "application/pdf" || ext === "pdf") return "pdf";
  if (String(mimeType).startsWith("audio/")) return "audio";
  if (String(mimeType).startsWith("video/")) return "video";
  if (["txt", "md", "json", "csv", "tsv", "xml", "yaml", "yml", "log", "html"].includes(ext)) return "text";
  return "unsupported";
}

function registerDownload(filePath, downloadName, mimeType, options = {}) {
  const id = randomUUID();
  const assetsDir = options.assetsDir || null;
  // Capture ownership when conversion publishes its result. Discard never
  // accepts a path from the client and never recursively removes a directory.
  const owned = [captureOutput(filePath)];
  if (assetsDir) {
    const directory = captureOutput(assetsDir);
    if (directory?.directory) {
      for (const name of fs.readdirSync(assetsDir)) owned.push(captureOutput(path.join(assetsDir, name)));
      owned.push(directory);
    } else owned.push(null);
  }
  downloads.set(id, {
    filePath,
    downloadName,
    mimeType,
    assetsDir,
    createdAt: Date.now(),
    owned,
    activeReaders: 0,
    discarded: false
  });
  return {
    downloadUrl: `/downloads/${id}`,
    previewUrl: `/previews/${id}`,
    previewKind: previewKindFor(downloadName, mimeType)
  };
}

function captureOutput(filePath) {
  try {
    const resolved = path.resolve(filePath);
    const relative = path.relative(OUTPUT_DIR, resolved);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return null;
    const parents = [];
    let current = path.resolve(OUTPUT_DIR);
    for (const part of ['.', ...path.dirname(relative).split(path.sep).filter(part => part !== '.')]) {
      current = path.resolve(current, part);
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
      parents.push({ path: current, dev: stat.dev, ino: stat.ino });
    }
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink !== 1)) return null;
    return { path: resolved, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, directory: stat.isDirectory(), parents };
  } catch { return null; }
}

function outputStillOwned(entry) {
  const current = captureOutput(entry.path);
  return current && current.dev === entry.dev && current.ino === entry.ino
    && current.directory === entry.directory
    && (entry.directory || (current.size === entry.size && current.mtimeMs === entry.mtimeMs))
    && current.parents.length === entry.parents.length
    && current.parents.every((parent, index) => parent.dev === entry.parents[index].dev && parent.ino === entry.parents[index].ino);
}

function hasOtherDownloadOwner(entry, item) {
  for (const other of downloads.values()) {
    if (other === item) continue;
    for (const location of [other.filePath, other.assetsDir].filter(Boolean)) {
      const base = path.resolve(location);
      if (entry.path === base || entry.path.startsWith(base + path.sep)
        || (entry.directory && base.startsWith(entry.path + path.sep))) return true;
    }
  }
  return false;
}

let releaseQueue = Promise.resolve();
function releaseDownloads(ids) {
  for (const id of ids) {
    const item = downloads.get(id);
    if (item) item.discarded = true;
  }
  releaseQueue = releaseQueue.catch(() => {}).then(async () => {
    let count = 0;
    for (const [id, item] of downloads) {
      if (!item.discarded || item.activeReaders) continue;
      let retained = false;
      for (const entry of item.owned || [null]) {
        if (!entry) { retained = true; continue; }
        if (hasOtherDownloadOwner(entry, item)) continue;
        if (!fs.existsSync(entry.path)) continue;
        if (!outputStillOwned(entry)) { retained = true; continue; }
        try {
          // No await between identity validation and the single-entry delete.
          // Empty-directory removal preserves any files added since publishing.
          if (entry.directory) fs.rmdirSync(entry.path);
          else fs.unlinkSync(entry.path);
        } catch (error) {
          if (error.code !== 'ENOENT') retained = true;
        }
        if (++count % 32 === 0) await new Promise(resolve => setImmediate(resolve));
      }
      // Keep unsafe/replaced paths registered so periodic cleanup cannot
      // subsequently reinterpret them as unowned expired conversion products.
      if (!retained) downloads.delete(id);
    }
  });
  return releaseQueue;
}

function retainDownloadResponse(item, response) {
  item.activeReaders = (item.activeReaders || 0) + 1;
  let finished = false;
  const release = () => {
    if (finished) return;
    finished = true;
    item.activeReaders -= 1;
    if (item.discarded) void releaseDownloads([]).catch(error => logger.warn('Discard cleanup failed', error));
  };
  response.once('finish', release);
  response.once('close', release);
}

function downloadUrlFor(filePath, downloadName, mimeType) {
  return registerDownload(filePath, downloadName, mimeType).downloadUrl;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

module.exports = {
  ensureDirs,
  run,
  commandExists,
  extFromName,
  decodeUploadFileName,
  normalizeExt,
  categoryForExt,
  targetsForExt,
  platformCapabilities,
  experimentalInputWarning,
  safeBaseName,
  outputExtFor,
  outputNameFor,
  outputPathFor,
  previewKindFor,
  registerDownload,
  releaseDownloads,
  retainDownloadResponse,
  downloadUrlFor,
  escapeHtml
};
