const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { PDFDocument } = require("pdf-lib");
const { extractComplexPdfTableModel } = require("../src/pdf-table");
const { convertPdf } = require("../src/pdf");

async function scratch(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fm-conversion-audit-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("partial Camelot success retains an uncovered scanned PDF page as editable cells", async (t) => {
  const root = await scratch(t);
  const doc = await PDFDocument.create();
  doc.addPage([300, 120]).drawText("NATIVE PAGE ONE", { x: 10, y: 50 });
  // The page genuinely has no PDF text. OCR is substituted at the engine seam,
  // while PDF loading, Camelot acceptance and workbook composition are real.
  const png = await doc.embedPng(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  doc.addPage([300, 120]).drawImage(png, { x: 0, y: 0, width: 300, height: 120 });
  const input = path.join(root, "mixed.pdf");
  await fs.writeFile(input, await doc.save());
  const seen = [];
  const model = await extractComplexPdfTableModel(input, {
    extractTablesViaDocengine: async () => [{ page: 1, flavor: "stream", accuracy: 100, cells: [["NATIVE PAGE ONE"]] }],
    renderPage: async () => null,
    ocrPage: async (page) => {
      seen.push(page.pageNumber);
      return { data: { words: [
        ["Item", 10, 10], ["Qty", 160, 10], ["SCAN_PAGE_TWO", 10, 40], ["1.5", 160, 40]
      ].map(([text, x, y]) => ({ text, confidence: 96, bbox: { x0: x, y0: y, x1: x + 90, y1: y + 14 } })) } };
    }
  });
  assert.deepEqual([...new Set(model.summary.map(page => page.pageNumber))].sort(), [1, 2]);
  assert.deepEqual(seen, [2], "only the uncovered scanned page needs OCR");
  assert.deepEqual(model.sheets.map(sheet => sheet.pages[0]), [1, 2]);
  assert.equal(new Set(model.sheets.map(sheet => sheet.name)).size, model.sheets.length);
  assert.ok(model.sheets.some(sheet => sheet.rows.flat().includes("NATIVE PAGE ONE")));
  assert.ok(model.sheets.some(sheet => sheet.rows.flat().includes("SCAN_PAGE_TWO")));
  assert.ok(model.sheets.some(sheet => sheet.rows.flat().includes("1.5")));
});

test("an uncovered genuinely blank page is accounted for without requiring OCR", async (t) => {
  const root = await scratch(t);
  const doc = await PDFDocument.create();
  doc.addPage([300, 120]).drawText("KEPT NATIVE", { x: 10, y: 50 });
  doc.addPage([300, 120]);
  const input = path.join(root, "blank-page.pdf");
  await fs.writeFile(input, await doc.save());
  const model = await extractComplexPdfTableModel(input, {
    extractTablesViaDocengine: async () => [{ page: 1, flavor: "stream", accuracy: 100, cells: [["KEPT NATIVE"]] }],
    renderPage: async () => null,
    ocrPage: async () => { assert.fail("blank pages must not be sent to OCR"); }
  });
  assert.deepEqual(model.summary.map(page => page.pageNumber), [1, 2]);
  assert.ok(model.sheets.some(sheet => sheet.pages.includes(2)));
});

test("one accurate Camelot page cannot hide a poor or out-of-range page result", async (t) => {
  const root = await scratch(t);
  const doc = await PDFDocument.create();
  doc.addPage([300, 120]).drawText("PAGE ONE", { x: 10, y: 50 });
  doc.addPage([300, 120]).drawText("PAGE TWO ORIGINAL", { x: 10, y: 50 });
  const input = path.join(root, "per-page-quality.pdf");
  await fs.writeFile(input, await doc.save());
  const model = await extractComplexPdfTableModel(input, {
    extractTablesViaDocengine: async () => [
      { page: 1, flavor: "stream", accuracy: 100, cells: [["PAGE ONE"]] },
      { page: 2, flavor: "stream", accuracy: 30, cells: [["WRONG LOW QUALITY"]] },
      { page: 999, flavor: "stream", accuracy: 100, cells: [["INVALID PAGE"]] }
    ],
    renderPage: async () => null,
    ocrPage: async () => { assert.fail("native text does not need OCR"); }
  });
  assert.deepEqual(model.summary.map(page => page.pageNumber), [1, 2]);
  const cells = model.sheets.flatMap(sheet => sheet.rows.flat());
  assert.ok(cells.includes("PAGE TWO ORIGINAL"));
  assert.ok(!cells.includes("WRONG LOW QUALITY"));
  assert.ok(!cells.includes("INVALID PAGE"));
});

test("an unreadable uncovered scan rejects instead of returning only successful native pages", async (t) => {
  const root = await scratch(t);
  const doc = await PDFDocument.create();
  doc.addPage([300, 120]).drawText("NATIVE", { x: 10, y: 50 });
  doc.addPage([300, 120]).drawRectangle({ x: 10, y: 10, width: 100, height: 80 });
  const input = path.join(root, "unreadable-page.pdf");
  await fs.writeFile(input, await doc.save());
  await assert.rejects(extractComplexPdfTableModel(input, {
    extractTablesViaDocengine: async () => [{ page: 1, flavor: "stream", accuracy: 100, cells: [["NATIVE"]] }],
    renderPage: async () => null,
    ocrPage: async () => ({ data: { words: [] } })
  }), { code: "PDF_TABLE_OCR_EMPTY" });
});

test("PDF encryption and decryption preserve the same whitespace-bearing password", async (t) => {
  const { QPDF_PATH } = require("../src/config");
  if (spawnSync(QPDF_PATH, ["--version"], { windowsHide: true, timeout: 5000 }).status !== 0) {
    return t.skip("real qpdf is required for password roundtrip");
  }
  const root = await scratch(t);
  const doc = await PDFDocument.create();
  doc.addPage().drawText("PASSWORD ROUNDTRIP");
  const input = path.join(root, "plain.pdf");
  const encrypted = path.join(root, "encrypted.pdf");
  const decrypted = path.join(root, "decrypted.pdf");
  await fs.writeFile(input, await doc.save());
  await convertPdf(input, encrypted, "pdf", { pdfAction: "encrypt", password: " x " });
  await convertPdf(encrypted, decrypted, "pdf", { pdfAction: "decrypt", password: " x " });
  assert.equal((await PDFDocument.load(await fs.readFile(decrypted))).getPageCount(), 1);
  const wrong = spawnSync(QPDF_PATH, ["--password=x", "--check", encrypted], { windowsHide: true });
  assert.notEqual(wrong.status, 0, "trimmed password must not silently replace the requested one");
  await assert.rejects(convertPdf(input, path.join(root, "empty.pdf"), "pdf", {
    pdfAction: "encrypt", password: "   "
  }), { code: "PDF_ENCRYPT_NO_PASSWORD" });
});
