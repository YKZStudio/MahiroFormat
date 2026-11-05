"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { createQpdfFilter, trimQpdfDistribution } = require("../scripts/trim-qpdf-distribution");
const { LIBREOFFICE_DISTRIBUTION_FILTER, APP_DISTRIBUTION_EXCLUSIONS, createLibreOfficeFilter, createApplicationFilter } = require("../scripts/distribution-filters");

test("Windows packaging applies the validated distribution selection", () => {
  const { build } = require("../package.json");
  assert.deepEqual(build.win.extraResources.find(item => item.to === "libreoffice").filter, LIBREOFFICE_DISTRIBUTION_FILTER);
  for (const exclusion of APP_DISTRIBUTION_EXCLUSIONS) assert.ok(build.files.includes(exclusion), exclusion);
});

test("LibreOffice reduction selects only thesauri and verified non-default UI themes", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fm-lo-distribution-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const remove = ["share/extensions/dict-de/th_de_DE_v2.dat", "share/extensions/dict-de/th_de_DE_v2.idx", "share/config/images_karasa_jaga_svg.zip", "share/config/images_breeze.zip"];
  const keep = ["program/soffice.com", "program/vcllo.dll", "share/extensions/dict-de/de_DE.dic", "share/extensions/dict-de/de_DE.aff", "share/extensions/dict-de/hyph_de_DE.dic", "share/extensions/dict-de/LICENSE", "share/extensions/dict-de/README_th_de_DE.txt", "share/config/images_colibre.zip", "share/config/images_colibre_dark_svg.zip", "share/config/images_helpimg.zip", "share/config/images_future_theme.zip", "share/template/th_sample.dat"];
  for (const prefix of ["", "LibreOfficePortable/App/libreoffice/"]) {
    const filter = createLibreOfficeFilter(root);
    for (const [files, expected] of [[remove, false], [keep, true]]) for (const relative of files) {
      const file = path.join(root, prefix + relative);
      await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, relative);
      assert.equal(filter(file, await fs.stat(file)), expected, prefix + relative);
    }
  }
});

test("application reduction keeps runtime code, OCR core and all license evidence", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fm-app-distribution-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const remove = ["node_modules/lib/runtime.js.map", "node_modules/pdfjs-dist/build/pdf.mjs.map", "node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz", "node_modules/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz", "node_modules/@tesseract.js-data/tha/4.0.0/tha.traineddata.gz"];
  const keep = ["node_modules/lib/runtime.js", "node_modules/lib/LICENSE", "node_modules/pdfjs-dist/LICENSE", "node_modules/tesseract.js-core/tesseract-core.wasm", "node_modules/tesseract.js/src/worker-script/node/index.js", "node_modules/@tesseract.js-data/eng/LICENSE", "resources/tessdata/eng.traineddata.gz", "node_modules/map-data/geography.map"];
  const filter = createApplicationFilter(root);
  for (const [files, expected] of [[remove, false], [keep, true]]) for (const relative of files) {
    const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, relative);
    assert.equal(filter(file, await fs.stat(file)), expected, relative);
  }
});

async function fixture(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "fm-qpdf-distribution-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "resources", "qpdf");
  const files = {
    "bin/qpdf.exe": "runtime executable", "bin/qpdf30.dll": "runtime dependency",
    "bin/zlib1.dll": "runtime dependency", "LICENSE.txt": "root license",
    "share/doc/qpdf/manual-html/license.html": "upstream license notice",
    "share/doc/qpdf/manual-html/_sources/license.rst.txt": "upstream license source",
    "share/doc/dependency/NOTICE.txt": "dependency attribution",
    "lib/qpdf_static.lib": "unused development library", "include/qpdf/QPDF.hh": "unused header",
    "share/doc/qpdf/manual-html/_static/fonts/manual.ttf": "manual font",
    "share/doc/qpdf/qpdf-manual.pdf": "manual document"
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, contents);
  }
  return { root, files };
}

test("fresh Windows resource filtering retains every runtime and notice but excludes developer payload", async t => {
  const { root, files } = await fixture(t);
  const filter = createQpdfFilter(root);
  for (const relative of Object.keys(files)) {
    const file = path.join(root, relative);
    const expected = relative.startsWith("bin/") || /(?:license|notice)/i.test(relative);
    assert.equal(filter(file, await fs.stat(file)), expected, relative);
  }
});

test("Store staging trimming matches fresh-build selection and preserves retained bytes", async t => {
  const { root, files } = await fixture(t);
  const before = new Map(Object.entries(files));
  const result = trimQpdfDistribution(root);
  assert.ok(result.removedBytes > 0);
  for (const [relative, contents] of before) {
    if (relative.startsWith("bin/") || /(?:license|notice)/i.test(relative)) {
      assert.equal(await fs.readFile(path.join(root, relative), "utf8"), contents, relative);
    } else await assert.rejects(fs.stat(path.join(root, relative)), { code: "ENOENT" });
  }
  assert.equal(trimQpdfDistribution(root).removedBytes, 0, "already-trimmed fresh builds remain unchanged");
});

test("missing license evidence stops Store staging before deleting anything", async t => {
  const { root } = await fixture(t);
  await fs.unlink(path.join(root, "share/doc/qpdf/manual-html/license.html"));
  assert.throws(() => trimQpdfDistribution(root), /license/i);
  assert.equal(await fs.readFile(path.join(root, "lib/qpdf_static.lib"), "utf8"), "unused development library");
});

test("filtered real qpdf retains executable dependencies and completes PDF encryption roundtrip", async t => {
  const inputRoot = process.env.FLYINGMOUSE_TEST_QPDF_DISTRIBUTION || path.join(__dirname, "../bin/qpdf/extracted/qpdf-12.4.0-msvc64");
  try { await fs.access(path.join(inputRoot, "bin/qpdf.exe")); }
  catch { t.skip("Locked Windows qpdf distribution is unavailable"); return; }
  if (process.platform !== "win32") { t.skip("Windows qpdf execution"); return; }
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "fm-qpdf-runtime-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const filtered = path.join(parent, "resources", "qpdf");
  const filter = createQpdfFilter(inputRoot);
  await fs.cp(inputRoot, filtered, { recursive: true, filter: async file => filter(file, await fs.stat(file)) });
  for (const notice of ["share/doc/qpdf/manual-html/license.html", "share/doc/qpdf/manual-html/_sources/license.rst.txt"]) {
    assert.deepEqual(await fs.readFile(path.join(filtered, notice)), await fs.readFile(path.join(inputRoot, notice)));
  }
  await assert.rejects(fs.stat(path.join(filtered, "lib/qpdf_static.lib")), { code: "ENOENT" });
  const { PDFDocument } = require("pdf-lib");
  const document = await PDFDocument.create(); document.addPage().drawText("qpdf distribution runtime acceptance");
  const original = path.join(parent, "original.pdf"), encrypted = path.join(parent, "encrypted.pdf"), decrypted = path.join(parent, "decrypted.pdf");
  await fs.writeFile(original, await document.save());
  const executable = path.join(filtered, "bin/qpdf.exe");
  for (const args of [["--version"], ["--check", original],
    ["--encrypt", "test-password", "test-owner", "256", "--", original, encrypted],
    ["--password=test-password", "--decrypt", encrypted, decrypted], ["--check", decrypted]]) {
    const result = spawnSync(executable, args, { encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  }
  assert.equal((await PDFDocument.load(await fs.readFile(decrypted))).getPageCount(), 1);
});
