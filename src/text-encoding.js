"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { TextDecoder } = require("node:util");
const { LIMITS, ResourceLimitError } = require("./resource-policy");
const { throwIfCanceled } = require("./conversion-cancellation");

const ENCODINGS = new Set(["auto", "utf-8", "gb18030", "utf-16le", "utf-16be"]);
const MiB = 1024 * 1024;
// Source bytes, decoded text, escaped XHTML and ZIP metadata coexist. This is
// admission control for the in-memory text writer, not a media upload limit.
const MAX_TEXT_INPUT_BYTES = Math.max(MiB, Math.min(64 * MiB, Math.floor(LIMITS.workingBytes / 16)));

function encodingError(code) {
  const unsupported = code === "EPUB_TEXT_ENCODING_UNSUPPORTED";
  const messages = unsupported ? {
    zhCN: "不支持所选文本编码，请选择 UTF-8、GBK/GB18030 或 UTF-16。",
    enUS: "Unsupported text encoding. Select UTF-8, GBK/GB18030 or UTF-16."
  } : {
    zhCN: "无法按当前编码完整读取文本，已停止转换以避免乱码。请在“源文件编码”中选择正确编码（如 GBK/GB18030 或 UTF-16）后重试。",
    enUS: "The selected encoding cannot decode the complete text. Conversion stopped to avoid corrupt text. Choose the correct source encoding, such as GBK/GB18030 or UTF-16, and retry."
  };
  return Object.assign(new Error(messages.zhCN), { code, messages });
}

function decodeTextBuffer(bytes, encoding = "auto") {
  if (!ENCODINGS.has(encoding)) throw encodingError("EPUB_TEXT_ENCODING_UNSUPPORTED");
  const bom = bytes.subarray(0, 4).toString("hex");
  if (bom === "fffe0000" || bom === "0000feff") throw encodingError("EPUB_TEXT_ENCODING_UNSUPPORTED");
  const detected = bom.startsWith("efbbbf") ? "utf-8" : bom.startsWith("fffe") ? "utf-16le" : bom.startsWith("feff") ? "utf-16be" : null;
  const selected = encoding === "auto" ? detected || "utf-8" : encoding;
  if (detected && detected !== selected) throw encodingError("EPUB_TEXT_DECODE_FAILED");
  let text;
  try { text = new TextDecoder(selected, { fatal: true }).decode(bytes); }
  catch { throw encodingError("EPUB_TEXT_DECODE_FAILED"); }
  // Invalid XML controls also catch BOM-less UTF-16 accidentally read as UTF-8.
  // Preserve characters or reject explicitly; never replace them silently.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(text)) throw encodingError("EPUB_TEXT_DECODE_FAILED");
  return text;
}

async function readTextInput(inputPath, { encoding = "auto", signal, maxBytes = MAX_TEXT_INPUT_BYTES } = {}) {
  if (!ENCODINGS.has(encoding)) throw encodingError("EPUB_TEXT_ENCODING_UNSUPPORTED");
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_TEXT_INPUT_BYTES) throw new RangeError("Invalid text input budget");
  throwIfCanceled(signal);
  const overBudget = () => new ResourceLimitError("TEXT_INPUT_BUDGET_EXCEEDED", { limitMiB: Math.round(maxBytes / MiB * 100) / 100 });
  const stat = await fsp.stat(inputPath);
  if (!stat.isFile()) throw encodingError("EPUB_TEXT_DECODE_FAILED");
  if (stat.size > maxBytes) throw overBudget();
  throwIfCanceled(signal);
  const input = fs.createReadStream(inputPath, { highWaterMark: 64 * 1024, signal });
  const chunks = []; let bytes = 0;
  try {
    for await (const chunk of input) {
      throwIfCanceled(signal);
      bytes += chunk.length;
      if (bytes > maxBytes) throw overBudget();
      chunks.push(chunk);
    }
  } catch (error) {
    throwIfCanceled(signal);
    throw error;
  } finally { input.destroy(); }
  throwIfCanceled(signal);
  return decodeTextBuffer(Buffer.concat(chunks, bytes), encoding);
}

module.exports = { decodeTextBuffer, readTextInput, MAX_TEXT_INPUT_BYTES };
