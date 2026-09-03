const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { test } = require("node:test");
const sharp = require("sharp");
const { PDFDocument, PDFName } = require("pdf-lib");
const { convertImagesToPdf } = require("../image");
const { loadWithOverrides } = require("./helpers/load-with-overrides");

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mahiro-image-pdf-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const inputPath = path.join(root, "图片 🐱.png");
  await sharp({ create: { width: 4, height: 3, channels: 3, background: "#ff0000" } }).png().toFile(inputPath);
  return { root, inputPath, outputPath: path.join(root, "结果.pdf") };
}

test("image PDF preserves page order, RGB pixels, blank pages and exact xref offsets", async (t) => {
  const { root, inputPath, outputPath } = await fixture(t);
  const transparent = path.join(root, "transparent.png");
  await sharp({ create: { width: 2, height: 5, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(transparent);
  const original = await fsp.readFile(inputPath);
  await convertImagesToPdf([{ inputPath }, { blank: true }, { inputPath: transparent }, { blank: true }], outputPath);
  const bytes = await fsp.readFile(outputPath);
  const pdf = await PDFDocument.load(bytes);
  assert.deepEqual(pdf.getPages().map((page) => page.getSize()), [
    { width: 4, height: 3 }, { width: 595, height: 842 }, { width: 2, height: 5 }, { width: 595, height: 842 }
  ]);
  pdf.getPages().forEach((page, index) => {
    const stream = page.node.Resources().lookup(PDFName.of("XObject")).lookup(PDFName.of(`Im${index + 1}`));
    const pixels = zlib.inflateSync(stream.getContents());
    const { width, height } = page.getSize();
    const expected = index === 0 ? Buffer.from([255, 0, 0]) : Buffer.from([255, 255, 255]);
    assert.deepEqual(pixels, Buffer.alloc(width * height * 3, expected));
  });
  const text = bytes.toString("latin1");
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)[1]);
  assert.equal(text.slice(startxref, startxref + 4), "xref");
  const entries = text.slice(startxref).split("\n");
  const objectCount = 14;
  assert.equal(entries[1], `0 ${objectCount + 1}`);
  for (let number = 1; number <= objectCount; number += 1) {
    const offset = Number(entries[number + 2].slice(0, 10));
    assert.ok(text.startsWith(`${number} 0 obj\n`, offset), `invalid offset for object ${number}`);
  }
  assert.deepEqual(await fsp.readFile(inputPath), original);
  assert.equal((await fsp.readdir(root)).some((name) => name.includes(".tmp-")), false);
});

test("image PDF checks empty input and total pixel budget before opening output", async (t) => {
  const { root, outputPath } = await fixture(t);
  await fsp.writeFile(outputPath, "existing result");
  await assert.rejects(convertImagesToPdf([], outputPath), /请选择|请先选择/);
  await assert.rejects(convertImagesToPdf(Array.from({ length: 201 }, () => ({ blank: true })), outputPath),
    (error) => error instanceof require("../resource-policy").ResourceLimitError);
  assert.equal(await fsp.readFile(outputPath, "utf8"), "existing result");
  assert.equal((await fsp.readdir(root)).some((name) => name.includes(".tmp-")), false);
});

test("late image decode failure preserves the old output and removes the partial file", async (t) => {
  const { root, inputPath, outputPath } = await fixture(t);
  const broken = path.join(root, "broken.png");
  await fsp.writeFile(broken, "header-only image fixture");
  await fsp.writeFile(outputPath, "existing result");
  const failure = new Error("decode failed after metadata");
  const image = loadWithOverrides(path.join(__dirname, "..", "image.js"), {
    sharp: (file, options) => file === broken ? {
      metadata: async () => ({ width: 2, height: 2 }),
      rotate() { throw failure; }
    } : sharp(file, options)
  });
  await assert.rejects(image.convertImagesToPdf([{ inputPath }, { inputPath: broken }], outputPath), (error) => error === failure);
  assert.equal(await fsp.readFile(outputPath, "utf8"), "existing result");
  assert.equal((await fsp.readdir(root)).some((name) => name.includes(".tmp-")), false);
});

test("image PDF cleans up write failures without replacing an existing result", async (t) => {
  const { root, inputPath, outputPath } = await fixture(t);
  await fsp.writeFile(outputPath, "existing result");
  const failure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
  let closed = false;
  const image = loadWithOverrides(path.join(__dirname, "..", "image.js"), {
    "fs/promises": { ...fsp, async open(...args) {
      const handle = await fsp.open(...args);
      return { writeFile: async () => { throw failure; }, close: async () => { await handle.close(); closed = true; } };
    } }
  });
  await assert.rejects(image.convertImagesToPdf([{ inputPath }], outputPath), (error) => error === failure);
  assert.equal(closed, true);
  assert.equal(await fsp.readFile(outputPath, "utf8"), "existing result");
  assert.equal((await fsp.readdir(root)).some((name) => name.includes(".tmp-")), false);
});

test("image PDF cleans up publication failure and can replace a regular output", async (t) => {
  const { root, inputPath, outputPath } = await fixture(t);
  await fsp.mkdir(outputPath);
  await assert.rejects(convertImagesToPdf([{ inputPath }], outputPath));
  assert.equal((await fsp.stat(outputPath)).isDirectory(), true);
  assert.equal((await fsp.readdir(root)).some((name) => name.includes(".tmp-")), false);
  await fsp.rmdir(outputPath);
  await fsp.writeFile(outputPath, "existing result");
  await convertImagesToPdf([{ inputPath }], outputPath);
  assert.equal((await PDFDocument.load(await fsp.readFile(outputPath))).getPageCount(), 1);
  // A temporary suffix must not push a valid output basename beyond 255 bytes.
  const longOutput = path.join(root, `${"x".repeat(220)}.pdf`);
  await convertImagesToPdf([{ inputPath }], longOutput);
  assert.equal((await PDFDocument.load(await fsp.readFile(longOutput))).getPageCount(), 1);
});

test("image PDF compression uses asynchronous zlib for image and blank pages", async (t) => {
  const { inputPath, outputPath } = await fixture(t);
  let calls = 0;
  const image = loadWithOverrides(path.join(__dirname, "..", "image.js"), {
    zlib: { ...zlib, deflateSync() { assert.fail("compression must not block the main thread"); },
      deflate(...args) { calls += 1; return zlib.deflate(...args); } }
  });
  await image.convertImagesToPdf([{ inputPath }, { blank: true }, { blank: true }], outputPath);
  assert.equal(calls, 2, "blank image data is reused within the conversion");
});

test("image PDF decodes pages on demand as the output consumes chunks", async (t) => {
  const { inputPath, outputPath } = await fixture(t);
  let decoded = 0;
  let writtenImages = 0;
  const image = loadWithOverrides(path.join(__dirname, "..", "image.js"), {
    sharp: (...args) => {
      const pipeline = sharp(...args);
      const toBuffer = pipeline.toBuffer.bind(pipeline);
      pipeline.toBuffer = (...options) => { decoded += 1; return toBuffer(...options); };
      return pipeline;
    },
    "fs/promises": { ...fsp, async open(...args) {
      const handle = await fsp.open(...args);
      return {
        close: () => handle.close(),
        async writeFile(chunks) {
          assert.equal(decoded, 0, "preflight must not retain decoded images");
          await handle.writeFile((async function* () {
            for await (const chunk of chunks) {
              if (chunk.includes(Buffer.from("/Subtype /Image"))) {
                writtenImages += 1;
                assert.equal(decoded, writtenImages, "do not decode later pages before writing this one");
              }
              yield chunk;
            }
          })());
        }
      };
    } }
  });
  await image.convertImagesToPdf(Array.from({ length: 8 }, () => ({ inputPath })), outputPath);
  assert.equal(writtenImages, 8);
  assert.equal(decoded, 8);
});
