const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  LIMITS,
  calculateResourceLimits,
  ResourceLimitError,
  imageDecodedPixels,
  assertImageMetadata,
  assertImagePdfBudget,
  assertBatchBytes,
  assertPdfPages
} = require("../src/resource-policy");

const largeMemory = calculateResourceLimits({totalMemory:32*1024**3,freeMemory:16*1024**3});

test("admission uses a finite device memory budget, including low-memory machines", () => {
  const small = calculateResourceLimits({totalMemory:2*1024**3,freeMemory:128*1024**2});
  assert.ok(small.maxImagePixels < largeMemory.maxImagePixels);
  assert.ok(largeMemory.workingBytes <= 1024**3);
  for (const value of Object.values(LIMITS)) assert.ok(value > 0 && value <= Number.MAX_SAFE_INTEGER);
  assert.ok(small.maxImagePixels*16 <= small.workingBytes);
});

test("decoded image pixels include every animation frame", () => {
  assert.equal(imageDecodedPixels({ width: 4000, height: 3000 }), 12_000_000);
  assert.equal(imageDecodedPixels({ width: 1000, height: 6000, pageHeight: 1000, pages: 6 }), 6_000_000);
});

test("large drawings within budget keep their pixels; impossible decodes are rejected before allocation", () => {
  assert.equal(assertImageMetadata({ width: 10_000, height: 5000 }, largeMemory), 50_000_000);
  assert.throws(()=>assertImageMetadata({width:100_000,height:100_000},largeMemory),{errorCode:"IMAGE_DIMENSION_EXCEEDED"});
  assert.throws(() => assertImageMetadata({ width: 16_385, height: 10 },largeMemory), {errorCode:"IMAGE_DIMENSION_EXCEEDED"});
});

test("image-to-PDF includes aggregate decoded memory instead of only each image", () => {
  const big = { width: 8000, height: 5000 };
  assert.equal(assertImagePdfBudget([big],largeMemory), 40_000_000);
  assert.throws(()=>assertImagePdfBudget([big,big,big],largeMemory),{errorCode:"IMAGE_PDF_BUDGET_EXCEEDED"});
});

test("large supported files remain allowed while unbounded batches and PDF jobs fail clearly", () => {
  assert.equal(assertBatchBytes([{ size: 2 * 1024 * 1024 * 1024 }]), 2 * 1024 * 1024 * 1024);
  assert.throws(()=>assertBatchBytes([{size:100*1024**3}]),{errorCode:"BATCH_BYTES_EXCEEDED"});
  assert.equal(assertPdfPages(1500,{limits:largeMemory}),1500);
  assert.equal(assertPdfPages(10000,{limits:largeMemory}),10000);
  assert.equal(assertPdfPages(100, { ocr: true,limits:largeMemory }), 100);
});

test("malformed image, batch and page metadata fail closed", () => {
  assert.throws(
    () => assertImageMetadata({ width: "100", height: 100 }),
    (error) => error instanceof ResourceLimitError && error.errorCode === "IMAGE_METADATA_INVALID"
  );
  assert.throws(
    () => assertImageMetadata({ width: 10_000, height: 50_000, pageHeight: 1000, pages: 6 }),
    (error) => error instanceof ResourceLimitError && error.errorCode === "IMAGE_METADATA_INVALID"
  );
  assert.throws(
    () => assertBatchBytes([{ size: "2048" }]),
    (error) => error instanceof ResourceLimitError && error.errorCode === "BATCH_FILE_SIZE_INVALID"
  );
  assert.throws(
    () => assertBatchBytes([{ size: -1 }]),
    (error) => error instanceof ResourceLimitError && error.errorCode === "BATCH_FILE_SIZE_INVALID"
  );
  assert.throws(
    () => assertPdfPages(0),
    (error) => error instanceof ResourceLimitError && error.errorCode === "PDF_PAGE_COUNT_INVALID"
  );
});

test("native decoder rejections include complete bilingual budget messages", () => {
  for (const code of ['IMAGE_PIXELS_EXCEEDED','IMAGE_PDF_BUDGET_EXCEEDED','UPLOAD_FILE_COUNT_EXCEEDED','UPLOAD_FILE_SIZE_EXCEEDED']) {
    const error = new ResourceLimitError(code);
    assert.doesNotMatch(error.messages.zhCN, /\{[^}]+\}/);
    assert.doesNotMatch(error.messages.enUS, /\{[^}]+\}/);
  }
});
