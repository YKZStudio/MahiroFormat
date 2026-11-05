const sessionFetch = require("./helpers/authenticated-fetch");
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { test, before, after, mock } = require("node:test");
const { PDFDocument } = require("pdf-lib");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fm-progress-http-"));
process.env.FLYINGMOUSE_RUNTIME_DIR = root;
process.env.FLYINGMOUSE_LOG_FILE = path.join(root, "test.log");
const config = require("../src/config");
config.MAX_UPLOAD_BYTES = 4096;
// Capability discovery is unrelated to this lifecycle test. All conversions
// below still execute the real routes, Multer storage and JS image/PDF engines.
let renderedPageFixtures = null;
mock.method(require("../src/utils"), "commandExists", async command => command === config.PDFTOPPM_PATH);
// The native rendering boundary supplies deterministic tiny pages. HTTP,
// Sharp WEBP conversion, ZIP writing and progress reporting remain real.
mock.method(require("../src/utils"), "run", async (command, args, options) => {
  assert.equal(command, config.PDFTOPPM_PATH);
  assert.ok(args.includes("-progress") && renderedPageFixtures);
  const prefix = args.at(-1);
  for (const [index, bytes] of renderedPageFixtures.entries()) {
    const output = `${prefix}-${index + 1}.png`;
    await fsp.writeFile(output, bytes);
    options.onStderr(Buffer.from(`${index + 1} ${renderedPageFixtures.length} ${output}\n`));
  }
  return { stdout: "", stderr: "" };
});
mock.method(require("../src/office-engine"), "probeLibreOffice", async () => ({ enabled: false }));
mock.method(require("../src/markdown-document"), "pandocPath", () => "");
mock.method(require("../src/pdf-structure-engine"), "getStructuredPdfAvailability", async () => ({ enabled: false }));
const structuredBoundary = require("../src/pdf-structure-engine").withStructuredPdf;
let structuredFailure = null;
mock.method(require("../src/pdf-structure-engine"), "withStructuredPdf", (...args) =>
  structuredFailure ? Promise.reject(structuredFailure) : structuredBoundary(...args));
const { app, startServer } = require("../src/server");
let server, origin;
before(async () => {
  require("../src/utils").ensureDirs();
  ({ server, url: origin } = await startServer(0));
});
after(async () => {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true });
});
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>';
function imageForm() { const form = new FormData(); form.append("file", new Blob([svg]), "private-name.svg"); form.append("targetFormat", "png"); return form; }
async function progress(id) {
  const response = await sessionFetch(`${origin}/api/conversion-progress/${id}`, { headers: { Origin: origin } });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json();
}
async function waitForSnapshot(id, predicate) {
  for (let i = 0; i < 100; i++) {
    const response = await sessionFetch(`${origin}/api/conversion-progress/${id}`);
    if (response.ok) { const value = await response.json(); if (predicate(value)) return value; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("expected progress state was not observed");
}

test("real single conversion preserves downloadable content and publishes a private terminal receipt", async () => {
  const id = randomUUID();
  const response = await sessionFetch(origin + "/api/convert", { method: "POST", headers: { "X-FlyingMouse-Progress-Id": id }, body: imageForm() });
  assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.ok, true);
  const bytes = Buffer.from(await (await sessionFetch(origin + result.downloadUrl)).arrayBuffer());
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  const state = await progress(id); assert.equal(state.status, "succeeded"); assert.equal(state.stage, "completed");
  assert.deepEqual(Object.keys(state).sort(), ["id", "status", "stage", "completed", "total", "unit", "elapsedMs", "updatedAt"].sort());
  assert.ok(state.elapsedMs >= 0); assert.equal(state.total, null);
  assert.ok(!JSON.stringify(state).includes("private-name")); assert.ok(!JSON.stringify(state).includes(root));
});

test("image and PDF merge endpoints only complete after usable outputs exist", async () => {
  const imageId = randomUUID(), images = new FormData(); images.append("files", new Blob([svg]), "a.svg"); images.append("files", new Blob([svg]), "b.svg");
  const imageResponse = await sessionFetch(origin + "/api/convert-images-to-pdf", { method: "POST", headers: { "X-FlyingMouse-Progress-Id": imageId }, body: images });
  assert.equal(imageResponse.status, 200); const imageResult = await imageResponse.json();
  const pdfBytes = await (await sessionFetch(origin + imageResult.downloadUrl)).arrayBuffer();
  assert.equal((await PDFDocument.load(pdfBytes)).getPageCount(), 2); assert.equal((await progress(imageId)).status, "succeeded");
  const pdfId = randomUUID(), pdfs = new FormData(); pdfs.append("files", new Blob([pdfBytes]), "a.pdf"); pdfs.append("files", new Blob([pdfBytes]), "b.pdf");
  const pdfResponse = await sessionFetch(origin + "/api/merge-pdfs", { method: "POST", headers: { "X-FlyingMouse-Progress-Id": pdfId }, body: pdfs });
  assert.equal(pdfResponse.status, 200); const pdfResult = await pdfResponse.json();
  assert.equal((await PDFDocument.load(await (await sessionFetch(origin + pdfResult.downloadUrl)).arrayBuffer())).getPageCount(), 4);
  assert.equal((await progress(pdfId)).status, "succeeded");
});

test("same-origin checks, invalid headers and duplicate IDs reject before conversion", async () => {
  const id = randomUUID();
  let response = await sessionFetch(origin + "/api/convert", { method: "POST", headers: { Origin: "https://evil.example", "X-FlyingMouse-Progress-Id": id }, body: imageForm() });
  assert.equal(response.status, 403);
  assert.equal((await sessionFetch(origin + "/api/conversion-progress/" + id)).status, 404);
  response = await sessionFetch(origin + "/api/convert", { method: "POST", headers: { "X-FlyingMouse-Progress-Id": "not-a-uuid" }, body: imageForm() }); assert.equal(response.status, 400);
  response = await sessionFetch(origin + "/api/convert", { method: "POST", headers: { "X-FlyingMouse-Progress-Id": id }, body: imageForm() }); assert.equal(response.status, 200); await response.json();
  const beforeState = await progress(id);
  response = await sessionFetch(origin + "/api/convert", { method: "POST", headers: { "X-FlyingMouse-Progress-Id": id }, body: imageForm() }); assert.equal(response.status, 409);
  assert.deepEqual(await progress(id), beforeState);
  assert.equal((await sessionFetch(origin + "/api/conversion-progress/" + id, { headers: { Origin: "null" } })).status, 403);
  assert.equal((await sessionFetch(origin + "/api/conversion-progress/" + id, { headers: { Referer: "http://127.0.0.1:1/" } })).status, 403);
  assert.equal((await sessionFetch(origin + "/api/conversion-progress/not-a-uuid")).status, 400);
});

test("upload rejection, route validation and thrown conversion errors terminate as failed", async () => {
  for (const kind of ["large", "missing", "invalid"]) {
    const id = randomUUID(), form = new FormData(); form.append("targetFormat", "png");
    if (kind !== "missing") form.append("file", new Blob([kind === "large" ? Buffer.alloc(4097) : "broken image"]), "bad.svg");
    const response = await sessionFetch(origin + "/api/convert", { method: "POST", headers: { "X-FlyingMouse-Progress-Id": id }, body: form });
    assert.ok(response.status >= 400); await response.json(); assert.equal((await progress(id)).status, "failed");
  }
});

test("advanced PDF memory admission is a bilingual client rejection with failed progress", async t => {
  // Admission mechanics are tested by pdf-structure-engine.test.js. Inject its
  // stable failure here to exercise the real HTTP classification and cleanup.
  const messages = { zhCN: '高级 PDF 结构识别至少需要 5 GiB 可用内存。', enUS: 'Advanced PDF structure recognition requires 5 GiB available memory.' };
  structuredFailure = Object.assign(new Error(messages.enUS), { code: 'PDF_STRUCTURE_MEMORY_INSUFFICIENT', messages });
  t.after(() => { structuredFailure = null; });
  const pdf = await PDFDocument.create();
  const png = await require('sharp')({ create: { width: 2, height: 2, channels: 3, background: '#304050' } }).png().toBuffer();
  const embedded = await pdf.embedPng(png);
  pdf.addPage([100, 100]).drawImage(embedded, { x: 0, y: 0, width: 100, height: 100 });
  const form = new FormData(), id = randomUUID(), beforeDownloads = config.downloads.size;
  form.append('file', new Blob([await pdf.save()]), '扫描.pdf'); form.append('targetFormat', 'docx');
  const response = await sessionFetch(origin + '/api/convert', { method: 'POST', headers: { 'X-FlyingMouse-Progress-Id': id }, body: form });
  const result = await response.json();
  assert.equal(response.status, 422);
  assert.equal(result.errorCode, 'PDF_STRUCTURE_MEMORY_INSUFFICIENT'); assert.deepEqual(result.messages, messages);
  assert.equal(result.downloadUrl, undefined); assert.equal(config.downloads.size, beforeDownloads);
  const state = await progress(id); assert.equal(state.status, 'failed'); assert.equal(state.stage, 'failed');
});

test("output validation failure cannot publish succeeded after the engine returns", async t => {
  const stat = fsp.stat;
  t.mock.method(fsp, "stat", async (file, ...rest) => {
    if (path.resolve(String(file)).startsWith(path.resolve(config.OUTPUT_DIR) + path.sep)) throw new Error("fixture output validation failure");
    return stat(file, ...rest);
  });
  const id = randomUUID();
  const response = await sessionFetch(origin + "/api/convert", { method: "POST", headers: { "X-FlyingMouse-Progress-Id": id }, body: imageForm() });
  assert.equal(response.status, 500); await response.json(); assert.equal((await progress(id)).status, "failed");
});

for (const abort of [false, true]) test(`actual handler remains running through output validation; abort=${abort}`, async t => {
  const stat = fsp.stat;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  t.after(release);
  t.mock.method(fsp, "stat", async (file, ...rest) => {
    if (path.resolve(String(file)).startsWith(path.resolve(config.OUTPUT_DIR) + path.sep)) {
      const value = await stat(file, ...rest);
      // A filesystem boundary callback executes inside this real handler's ALS.
      require("../src/conversion-progress").reportConversionProgress({ stage: "validating", completed: 1, total: 1, unit: "files" });
      await barrier;
      return value;
    }
    return stat(file, ...rest);
  });
  const id = randomUUID(), controller = new AbortController();
  const request = sessionFetch(origin + "/api/convert", { method: "POST", signal: controller.signal,
    headers: { "X-FlyingMouse-Progress-Id": id }, body: imageForm() });
  // Observe rejection immediately if cancellation occurs before assertions end.
  request.catch(() => {});
  const state = await waitForSnapshot(id, value => value.stage === "validating" && value.completed === 1);
  assert.equal(state.status, "running", "100% of a stage is not a completed conversion");
  if (abort) {
    controller.abort(); await assert.rejects(request, { name: "AbortError" });
    await waitForSnapshot(id, value => value.status === "failed");
  }
  release();
  if (abort) {
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await progress(id)).status, "failed", "late engine/outputReady events must not revive cancellation");
  } else {
    const response = await request; assert.equal(response.status, 200); await response.json();
    assert.equal((await progress(id)).status, "succeeded");
  }
});

test("partial HTTP upload reports real bytes before parsing and abort becomes failed", async () => {
  const id = randomUUID();
  const request = http.request(origin + "/api/convert", { method: "POST", headers: {
    "X-Mahiro-Session-Token": (await (await fetch(origin + "/api/session")).json()).token,
    "Content-Type": "multipart/form-data; boundary=progress-test", "Content-Length": "1000", "X-FlyingMouse-Progress-Id": id
  } });
  request.on("error", () => {});
  const chunk = Buffer.from("--progress-test\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.svg\"\r\nContent-Type: image/svg+xml\r\n\r\npartial");
  request.write(chunk);
  const state = await waitForSnapshot(id, value => value.completed === chunk.length);
  assert.equal(state.stage, "uploading"); assert.equal(state.total, 1000); assert.equal(state.unit, "bytes");
  request.destroy();
  const failed = await waitForSnapshot(id, value => value.status === "failed");
  await new Promise(resolve => setTimeout(resolve, 20)); assert.deepEqual(await progress(id), failed);
});

test("legacy requests without the optional progress header keep their response contract", async () => {
  const response = await sessionFetch(origin + "/api/convert", { method: "POST", body: imageForm() });
  assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.ok, true); assert.ok(body.downloadUrl); assert.equal(body.progress, undefined);
});

test("disconnecting an actual EPUB request stops compression and removes its unregistered output", async t => {
  const { Transform } = require("node:stream");
  const yazl = require("yazl"), addLazy = yazl.ZipFile.prototype.addReadStreamLazy;
  let release, entered;
  const barrier = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  t.after(release);
  let ownOutput;
  const createWriteStream = fs.createWriteStream;
  t.mock.method(fs, "createWriteStream", (file, ...args) => {
    if (path.resolve(String(file)).startsWith(path.resolve(config.OUTPUT_DIR) + path.sep)
      && String(file).endsWith(".epub")) ownOutput = String(file);
    return createWriteStream(file, ...args);
  });
  // Hold only a real chapter's byte stream. ZIP compression, HTTP, cancellation
  // and cleanup are production code; no converter or response is substituted.
  t.mock.method(yazl.ZipFile.prototype, "addReadStreamLazy", function (name, options, getStream) {
    const original = typeof options === "function" ? options : getStream;
    const wrapped = callback => original((error, input) => {
      if (error || name !== "OEBPS/chapter-1.xhtml") return callback(error, input);
      const held = new Transform({ transform(chunk, _encoding, done) {
        entered(); barrier.then(() => done(null, chunk), done);
      } });
      input.on("error", error => held.destroy(error));
      input.pipe(held); callback(null, held);
    });
    return typeof options === "function" ? addLazy.call(this, name, wrapped) : addLazy.call(this, name, options, wrapped);
  });
  const id = randomUUID(), controller = new AbortController(), form = new FormData();
  const priorDownloads = config.downloads.size;
  form.append("file", new Blob(["第一段。\n\n第二段。"]), "cancel-book.txt"); form.append("targetFormat", "epub");
  const request = sessionFetch(origin + "/api/convert", { method: "POST", signal: controller.signal,
    headers: { "X-FlyingMouse-Progress-Id": id }, body: form });
  request.catch(() => {});
  let timeout;
  try {
    await Promise.race([started, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("EPUB never reached chapter stream")), 5000); })]);
  } finally { clearTimeout(timeout); }
  assert.ok(ownOutput && fs.existsSync(ownOutput));
  controller.abort(); await assert.rejects(request, { name: "AbortError" });
  await waitForSnapshot(id, value => value.status === "failed");
  release();
  for (let i = 0; i < 100 && fs.existsSync(ownOutput); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(fs.existsSync(ownOutput), false, "a disconnected request must not retain a completed EPUB");
  assert.equal(config.downloads.size, priorDownloads, "cancelled EPUB must not enter the download registry");
  assert.equal((await progress(id)).status, "failed");
});

test("EPUB auto encoding refuses malformed UTF-8 instead of publishing replacement characters", async () => {
  const id = randomUUID(), form = new FormData();
  form.append("file", new Blob([Buffer.from("d6d0cec4", "hex")]), "gbk-book.txt");
  form.append("targetFormat", "epub"); form.append("textEncoding", "auto");
  const response = await sessionFetch(origin + "/api/convert", { method: "POST",
    headers: { "X-FlyingMouse-Progress-Id": id }, body: form });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.errorCode, "EPUB_TEXT_DECODE_FAILED");
  assert.match(body.messages.zhCN, /GBK/); assert.match(body.messages.enUS, /encoding/i);
  assert.equal(body.downloadUrl, undefined);
  assert.equal((await progress(id)).status, "failed");
});

test("explicit GBK and BOM-marked UTF-16 produce actual EPUBs with the original Chinese text", async () => {
  const samples = [
    { name: "gbk.txt", encoding: "gb18030", bytes: Buffer.from("d6d0cec40a6120262062", "hex"), expected: "中文<br />a &amp; b" },
    { name: "utf16.txt", encoding: "auto", bytes: Buffer.from("\ufeff中文😀\n末尾", "utf16le"), expected: "中文😀<br />末尾" },
    { name: "gbk.csv", encoding: "gb18030", bytes: Buffer.from("d6d0cec42c310a", "hex"), expected: "中文,1<br />" },
    { name: "gbk.tsv", encoding: "gb18030", bytes: Buffer.from("d6d0cec409310a", "hex"), expected: '"中文","1"' }
  ];
  for (const sample of samples) {
    const id = randomUUID(), form = new FormData();
    form.append("file", new Blob([sample.bytes]), sample.name);
    form.append("targetFormat", "epub"); form.append("textEncoding", sample.encoding);
    const response = await sessionFetch(origin + "/api/convert", { method: "POST",
      headers: { "X-FlyingMouse-Progress-Id": id }, body: form });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
    const output = path.join(root, id + ".epub");
    fs.writeFileSync(output, Buffer.from(await (await sessionFetch(origin + result.downloadUrl)).arrayBuffer()));
    const archive = await require("jszip").loadAsync(fs.readFileSync(output), { checkCRC32: true });
    assert.ok((await archive.file("OEBPS/chapter-1.xhtml").async("string")).includes(`<p>${sample.expected}</p>`), sample.name);
    assert.equal((await progress(id)).status, "succeeded");
  }
});

for (const buffered of [false, true]) for (const failWrite of [false, true]) test(`PDF WEBP output clears completed page counts while ZIP is writing; failure=${failWrite}; buffered=${buffered}`, async t => {
  const sharp = require("sharp"), colors = [{ r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 }];
  renderedPageFixtures = await Promise.all(colors.map(background => sharp({ create: { width: 2, height: 2, channels: 3, background } }).png().toBuffer()));
  t.after(() => { renderedPageFixtures = null; });
  const pdf = await PDFDocument.create(); pdf.addPage([2, 2]); pdf.addPage([2, 2]);
  const input = await pdf.save(), id = randomUUID(), form = new FormData();
  form.append("file", new Blob([input]), "两页.pdf"); form.append("targetFormat", "webp");
  const create = fs.createWriteStream;
  let entered, release, ownOutput, sawBufferedWrite = false;
  const started = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  t.after(release);
  t.mock.method(fs, "createWriteStream", (file, ...args) => {
    const stream = create(file, ...args);
    if (path.resolve(String(file)).startsWith(path.resolve(config.OUTPUT_DIR) + path.sep)) {
      ownOutput = String(file);
      if (buffered) {
        // Delay only the real stream's construction callback so ZIP headers
        // queue and flush through the platform's actual vector-write path.
        const construct = stream._construct;
        stream._construct = function(callback) {
          construct.call(this, error => setTimeout(() => callback(error), 100));
        };
      }
      let held = false;
      for (const method of ['_write', '_writev']) {
        const write = stream[method];
        stream[method] = function(...args) {
          if (method === '_writev') sawBufferedWrite = true;
          if (held) return write.apply(this, args);
          held = true; entered();
          barrier.then(() => failWrite
            ? args.at(-1)(Object.assign(new Error("ZIP write failed"), { code: "ENOSPC" }))
            : write.apply(this, args));
        };
      }
    }
    return stream;
  });
  const beforeDownloads = config.downloads.size;
  const request = sessionFetch(origin + "/api/convert", { method: "POST", headers: { "X-FlyingMouse-Progress-Id": id }, body: form });
  let timer, during;
  try {
    await Promise.race([started, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("ZIP write was not reached")), 5000); })]);
    during = await progress(id);
  } finally { clearTimeout(timer); release(); }
  const response = await request, result = await response.json();
  if (buffered) assert.ok(sawBufferedWrite, 'forced buffering must exercise the real _writev path');
  t.diagnostic(`Observed during real ZIP write: ${JSON.stringify(during)}`);
  assert.equal(during.status, "running");
  assert.equal(during.stage, "converting");
  assert.equal(during.completed, null, "finished page counts must not describe ongoing ZIP output");
  assert.equal(during.total, null); assert.equal(during.unit, null);
  if (failWrite) {
    assert.equal(response.status, 500); assert.equal(result.downloadUrl, undefined);
    assert.equal((await progress(id)).status, "failed");
    assert.equal(config.downloads.size, beforeDownloads); assert.equal(fs.existsSync(ownOutput), false);
    return;
  }
  assert.equal(response.status, 200); assert.equal((await progress(id)).status, "succeeded");
  const output = Buffer.from(await (await sessionFetch(origin + result.downloadUrl)).arrayBuffer());
  const archive = await require("jszip").loadAsync(output, { checkCRC32: true });
  const names = Object.keys(archive.files).filter(name => !archive.files[name].dir);
  assert.deepEqual(names, ["两页-第1页.webp", "两页-第2页.webp"]);
  for (const [index, name] of names.entries()) {
    const bytes = await archive.file(name).async("nodebuffer");
    const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 2); assert.equal(info.height, 2); assert.equal(info.channels, 3);
    const expected = Object.values(colors[index]);
    for (let pixel = 0; pixel < data.length; pixel++) assert.ok(Math.abs(data[pixel] - expected[pixel % 3]) <= 4, "WEBP page content changed");
  }
});
