const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const sharp = require('sharp');
const { convertPdf } = require('../src/pdf');

async function fixture(t, { overlay = false, cropped = false, twoImages = false, alpha = false, nativeOverlap = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fm-pdf-scan-regions-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const png = await sharp({ create: { width: 400, height: 800, channels: alpha ? 4 : 3, background: alpha ? { r:255,g:255,b:255,alpha:.5 } : 'white' } }).png().toBuffer();
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('Original native header 1186.00', { x: 30, y: 810, size: 12, font });
  page.drawImage(await pdf.embedPng(png), { x: cropped ? -20 : 10, y: 10, width: twoImages ? 260 : 570, height: 410 });
  if (twoImages) page.drawImage(await pdf.embedPng(png), { x: 290, y: 10, width: 260, height: 410 });
  if (overlay) page.drawRectangle({ x: 10, y: 200, width: 500, height: 100, color: rgb(1, 1, 1) });
  if (nativeOverlap) page.drawText('Visible searchable text over scan', { x: 30, y: 210, size: 12, font });
  const input = path.join(dir, 'input.pdf');
  await fs.writeFile(input, await pdf.save());
  return { dir, input };
}

test('PDF OCR uses original scan pixels and preserves native reading order despite unequal PDF scaling', async t => {
  const { dir, input } = await fixture(t);
  const sizes = [];
  const output = path.join(dir, 'output.txt');
  const result = await convertPdf(input, output, 'txt', {
    ocrAvailable: () => true,
    createOcrWorker: async () => ({ terminate: async () => {} }),
    recognizeImageResultWithWorker: async (_worker, image) => {
      const { width, height } = await sharp(image).metadata(); sizes.push([width, height]);
      return { text: '采购明细单\n金额 474.00', confidence: 90, warnings: [] };
    }
  });
  assert.deepEqual(sizes, [[400, 800]]);
  const text = await fs.readFile(output, 'utf8');
  assert.match(text, /Original native header 1186\.00[\s\S]*采购明细单[\s\S]*474\.00/);
  assert.match(text, /采购明细单\n金额 474\.00/);
  assert.ok(result.warnings.some(w => w.code === 'PDF_OCR_ORIGINAL_IMAGE'));
});

test('overlays, crop, alpha masks and searchable overlaps require visible page rendering', async t => {
  const { extractPdfScanRegions } = require('../src/pdf-ocr-regions');
  const { extractPdfRowsByPage } = require('../src/pdf-table');
  for (const options of [{ overlay: true }, { cropped: true }, { alpha: true }, { nativeOverlap: true }]) {
    const { dir, input } = await fixture(t, options);
    const pages = await extractPdfRowsByPage(input);
    const regions = await extractPdfScanRegions(input, pages, dir);
    assert.equal(regions.get(1), undefined);
  }
});

test('image placement rejects clipping, hidden content, mirrored and skewed transforms', async () => {
  const { loadPdfjs } = require('../src/pdfjs');
  const { visibleImagePlacements } = require('../src/pdf-ocr-regions');
  const { OPS } = await loadPdfjs();
  const viewport = { transform:[1,0,0,-1,0,842], width:595, height:842 };
  const operators = transform => ({ fnArray:[OPS.save,OPS.transform,OPS.paintImageXObject,OPS.restore], argsArray:[null,transform,['image',400,800],null] });
  for (const transform of [[-400,0,0,400,500,10], [400,0,80,400,10,10]]) assert.deepEqual(visibleImagePlacements(operators(transform),OPS,viewport),[]);
  for (const unsafe of [OPS.clip,OPS.beginMarkedContentProps,OPS.paintImageMaskXObject,OPS.setGState]) {
    const value=operators([400,0,0,400,10,10]); value.fnArray.splice(1,0,unsafe);value.argsArray.splice(1,0,[]);
    assert.deepEqual(visibleImagePlacements(value,OPS,viewport),[]);
  }
  // A quarter-turn maps the region position while retaining original raw pixels;
  // the ordinary OCR orientation stage still recognizes the image itself.
  const quarterTurn=visibleImagePlacements(operators([0,300,-400,0,450,20]),OPS,viewport);
  assert.deepEqual(quarterTurn.map(r=>r.bbox),[[50,522,450,822]]);
});

test('separate visible scan regions retain page position and each original aspect ratio', async t => {
  const { extractPdfScanRegions } = require('../src/pdf-ocr-regions');
  const { extractPdfRowsByPage } = require('../src/pdf-table');
  const { dir, input } = await fixture(t, { twoImages: true });
  const regions = (await extractPdfScanRegions(input, await extractPdfRowsByPage(input), dir)).get(1);
  assert.equal(regions.length, 2);
  assert.ok(regions[0].bbox[0] < regions[1].bbox[0]);
  for (const region of regions) {
    const { width, height } = await sharp(region.outputPath).metadata();
    assert.deepEqual([width, height], [400, 800]);
  }
});

const samples = process.env.FLYINGMOUSE_OCR_AUDIT_SAMPLES;
test('actual mixed PDF retains Chinese purchase title and every exact monetary value', { skip: !samples, timeout: 60000 }, async t => {
  const { dir } = await fixture(t);
  const input = path.resolve(samples, '../root-review/partial-scan-native-paragraph.pdf');
  const output = path.join(dir, 'actual.txt');
  const result = await convertPdf(input, output, 'txt');
  const text = await fs.readFile(output, 'utf8');
  for (const expected of ['采购明细单', '474.00', '712.00', '1186.00', '13800138000']) assert.ok(text.replace(/\s/g, '').includes(expected), text);
  for (let index = 0; index < 7; index++) assert.equal((text.match(new RegExp(`Account metadata line ${index}`, 'g')) || []).length, 1);
  assert.ok(result.warnings.some(w => w.code === 'PDF_OCR_ORIGINAL_IMAGE'));
});
