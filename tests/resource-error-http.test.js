const sessionFetch = require("./helpers/authenticated-fetch");
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-resource-http-'));
process.env.FLYINGMOUSE_RUNTIME_DIR = root;
process.env.FLYINGMOUSE_LOG_FILE = path.join(root, 'test.log');
// Exercise the real route and Multer storage with a small admission threshold,
// avoiding a 16 GiB allocation just to cross the production upload threshold.
const config = require('../src/config');
config.MAX_UPLOAD_BYTES = 1024;
const { app, startServer } = require('../src/server');
const { ensureDirs } = require('../src/utils');
const { convertImage } = require('../src/image');
let server, origin;
before(async () => {
  ensureDirs(); ({ server, url: origin } = await startServer(0));
});
after(async () => {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
});
function svg(size) { return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="white"/></svg>`; }
function assertLocalizedLimit(body, code) {
  assert.equal(body.errorCode, code);
  assert.equal(body.error, body.messages.zhCN);
  assert.match(body.messages.zhCN, /[\u4e00-\u9fff]/);
  assert.match(body.messages.enUS, /[a-z]/i);
  assert.doesNotMatch(body.messages.zhCN + body.messages.enUS, /\{\w+\}/);
}
for (const target of ['png', 'ico']) {
test(`real SVG to ${target} returns a localized pixel budget rejection and removes upload/output residue`, async () => {
  const form = new FormData(); form.append('file', new Blob([svg(20000)]), 'large.svg'); form.append('targetFormat', target);
  const response = await sessionFetch(origin + '/api/convert', { method: 'POST', body: form });
  assert.equal(response.status, 413);
  const body = await response.json(); assertLocalizedLimit(body, 'IMAGE_PIXELS_EXCEEDED');
  assert.ok(body.details.limitMegapixels > 0);
  assert.deepEqual(fs.readdirSync(config.UPLOAD_DIR), []);
  assert.deepEqual(fs.readdirSync(config.OUTPUT_DIR), []);
});
}
test('direct image conversion also classifies the Sharp ICO pixel limit without mutating the source', async () => {
  const input = path.join(root, 'source.svg'), output = path.join(root, 'never.ico');
  const bytes = svg(20000); fs.writeFileSync(input, bytes);
  await assert.rejects(convertImage(input, output, 'ico'), error => {
    assert.equal(error.name, 'ResourceLimitError'); assertLocalizedLimit({ ...error, error: error.message }, 'IMAGE_PIXELS_EXCEEDED'); return true;
  });
  assert.equal(fs.readFileSync(input, 'utf8'), bytes); assert.equal(fs.existsSync(output), false);
});
test('1001 files return the actual file count limit and discard every partial/completed upload', async () => {
  const form = new FormData(); for (let i = 0; i < 1001; i++) form.append('files', new Blob(['']), `empty-${i}.png`);
  const response = await sessionFetch(origin + '/api/convert-images-to-pdf', { method: 'POST', body: form });
  assert.equal(response.status, 413);
  const body = await response.json(); assertLocalizedLimit(body, 'UPLOAD_FILE_COUNT_EXCEEDED'); assert.equal(body.details.limitFiles, 1000);
  assert.deepEqual(fs.readdirSync(config.UPLOAD_DIR), []);
});
test('a file above the configured threshold returns a bilingual size error and is removed', async () => {
  const form = new FormData(); form.append('file', new Blob([Buffer.alloc(1025)]), 'large.txt'); form.append('targetFormat', 'md');
  const response = await sessionFetch(origin + '/api/convert', { method: 'POST', body: form });
  assert.equal(response.status, 413);
  const body = await response.json(); assertLocalizedLimit(body, 'UPLOAD_FILE_SIZE_EXCEEDED'); assert.equal(body.details.limitGiB, 1024 / 1024 ** 3);
  assert.deepEqual(fs.readdirSync(config.UPLOAD_DIR), []);
});
test('admissible SVG produces a genuine PNG at its original dimensions', async () => {
  const original = svg(2); const form = new FormData(); form.append('file', new Blob([original]), 'small.svg'); form.append('targetFormat', 'png');
  const response = await sessionFetch(origin + '/api/convert', { method: 'POST', body: form }); assert.equal(response.status, 200);
  const body = await response.json(); const png = Buffer.from(await (await sessionFetch(origin + body.downloadUrl)).arrayBuffer());
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  assert.equal(png.readUInt32BE(16), 2); assert.equal(png.readUInt32BE(20), 2);
  assert.deepEqual(fs.readdirSync(config.UPLOAD_DIR), []);
});
