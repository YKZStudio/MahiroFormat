"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { decodeTextBuffer, readTextInput, MAX_TEXT_INPUT_BYTES } = require("../src/text-encoding");

function fileFixture(t, bytes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fm-text-encoding-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "source.txt"); fs.writeFileSync(file, bytes); return file;
}

test("UTF-8 and UTF-16 BOM decoding preserves Chinese, whitespace and surrogate pairs", async t => {
  const text = "  中文😀 & <原文>\r\n\r\n尾部\n";
  const le = Buffer.from("\ufeff" + text, "utf16le"), be = Buffer.from(le).swap16();
  for (const bytes of [Buffer.from(text), Buffer.from("\ufeff" + text), le, be]) {
    assert.equal(decodeTextBuffer(bytes), text);
    const file = fileFixture(t, bytes);
    assert.equal(await readTextInput(file), text);
    assert.deepEqual(fs.readFileSync(file), bytes, "decoding must not modify the source");
  }
});

test("legacy encodings require explicit selection and never silently insert replacement characters", () => {
  const gbk = Buffer.from("d6d0cec40a", "hex");
  assert.throws(() => decodeTextBuffer(gbk), { code: "EPUB_TEXT_DECODE_FAILED" });
  assert.equal(decodeTextBuffer(gbk, "gb18030"), "中文\n");
  for (const bytes of [Buffer.from([0x81]), Buffer.from([0xc3, 0x28])]) {
    assert.throws(() => decodeTextBuffer(bytes), { code: "EPUB_TEXT_DECODE_FAILED" });
  }
  assert.throws(() => decodeTextBuffer(Buffer.from([0x81]), "gb18030"), { code: "EPUB_TEXT_DECODE_FAILED" });
  const text = "中文😀";
  assert.equal(decodeTextBuffer(Buffer.from(text, "utf16le"), "utf-16le"), text);
  assert.equal(decodeTextBuffer(Buffer.from(text, "utf16le").swap16(), "utf-16be"), text);
  assert.throws(() => decodeTextBuffer(Buffer.from("hello", "utf16le")), { code: "EPUB_TEXT_DECODE_FAILED" });
  assert.equal(decodeTextBuffer(Buffer.from("original literal \ufffd")), "original literal \ufffd", "an original valid character is not decoding failure");
});

test("invalid encoding labels, conflicting BOMs, UTF-32 and malformed XML controls are rejected", () => {
  for (const encoding of ["shift-jis", "", ["utf-8"], {}, "UTF-8"]) {
    assert.throws(() => decodeTextBuffer(Buffer.from("text"), encoding), { code: "EPUB_TEXT_ENCODING_UNSUPPORTED" });
  }
  assert.throws(() => decodeTextBuffer(Buffer.from("\ufeff中文", "utf16le"), "utf-16be"), { code: "EPUB_TEXT_DECODE_FAILED" });
  assert.throws(() => decodeTextBuffer(Buffer.from("\ufefftext"), "gb18030"), { code: "EPUB_TEXT_DECODE_FAILED" });
  for (const hex of ["fffe000041000000", "0000feff00000041"]) {
    assert.throws(() => decodeTextBuffer(Buffer.from(hex, "hex")), { code: "EPUB_TEXT_ENCODING_UNSUPPORTED" });
  }
  assert.throws(() => decodeTextBuffer(Buffer.from("before\u0001after")), { code: "EPUB_TEXT_DECODE_FAILED" });
  for (const character of ["\ufffe", "\uffff"]) {
    assert.throws(() => decodeTextBuffer(Buffer.from("before" + character + "after")), { code: "EPUB_TEXT_DECODE_FAILED" });
  }
});

test("text input budget rejects before allocation and also counts actual stream bytes", async t => {
  assert.ok(Number.isSafeInteger(MAX_TEXT_INPUT_BYTES));
  assert.ok(MAX_TEXT_INPUT_BYTES > 0 && MAX_TEXT_INPUT_BYTES <= 64 * 1024 * 1024);
  const bytes = Buffer.from("a".repeat(32)), file = fileFixture(t, bytes);
  await assert.rejects(readTextInput(file, { maxBytes: 16 }), { errorCode: "TEXT_INPUT_BUDGET_EXCEEDED" });
  assert.equal(await readTextInput(file, { maxBytes: 32 }), bytes.toString());
  const stat = fsp.stat;
  t.mock.method(fsp, "stat", async (...args) => {
    const metadata = await stat(...args);
    // A file may grow after metadata is obtained. The real stream still reads
    // the 32-byte fixture, so admission cannot trust this earlier smaller size.
    if (args[0] === file) metadata.size = 8;
    return metadata;
  });
  await assert.rejects(readTextInput(file, { maxBytes: 16 }), { errorCode: "TEXT_INPUT_BUDGET_EXCEEDED" });
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test("cancelled text reads stop before opening or while consuming the actual file", async t => {
  const bytes = Buffer.alloc(256 * 1024, 65), file = fileFixture(t, bytes);
  const before = new AbortController(); before.abort();
  await assert.rejects(readTextInput(file, { signal: before.signal }), { code: "CONVERSION_CANCELED" });
  const active = new AbortController(), create = fs.createReadStream;
  let opened = false;
  t.mock.method(fs, "createReadStream", (...args) => {
    const stream = create(...args); opened = true;
    stream.once("data", () => active.abort()); return stream;
  });
  await assert.rejects(readTextInput(file, { signal: active.signal }), { code: "CONVERSION_CANCELED" });
  assert.equal(opened, true);
  assert.deepEqual(fs.readFileSync(file), bytes);
});
