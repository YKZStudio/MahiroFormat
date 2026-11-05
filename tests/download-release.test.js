const sessionFetch = require("./helpers/authenticated-fetch");
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { test, before, after } = require('node:test');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-release-'));
process.env.FLYINGMOUSE_RUNTIME_DIR = runtime;
process.env.FLYINGMOUSE_LOG_FILE = path.join(runtime, 'test.log');
const { app, startServer, cleanupOldFiles } = require('../src/server');
const { downloads, OUTPUT_DIR } = require('../src/config');
const { ensureDirs, registerDownload } = require('../src/utils');
let server, origin;
before(async () => {
  ensureDirs();
  ({ server, url: origin } = await startServer(0));
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(runtime, { recursive: true, force: true });
});
function output(name, contents = name, options = {}) {
  const file = path.join(OUTPUT_DIR, name);
  fs.writeFileSync(file, contents);
  const result = registerDownload(file, name, 'application/octet-stream', options);
  return { file, ...result, id: result.downloadUrl.split('/').pop() };
}
async function discard(ids, headers = {}) {
  return sessionFetch(`${origin}/api/downloads/release`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin, ...headers }, body: JSON.stringify({ ids })
  });
}
async function waitUntil(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(predicate(), 'release did not finish');
}
test('explicit IDs release only discarded output; visible unsaved output remains protected', async () => {
  const gone = output('gone.txt'), kept = output('visible.txt');
  const old = new Date(Date.now() - 48 * 3600000);
  fs.utimesSync(kept.file, old, old);
  assert.equal((await discard([gone.id])).status, 200);
  await waitUntil(() => !fs.existsSync(gone.file));
  assert.equal((await sessionFetch(origin + gone.downloadUrl)).status, 404);
  await cleanupOldFiles();
  assert.equal(fs.readFileSync(kept.file, 'utf8'), 'visible.txt');
  assert.equal((await sessionFetch(origin + kept.downloadUrl)).status, 200);
  assert.equal((await discard([gone.id])).status, 200, 'repeated release is harmless');
});
test('reject cross-origin and path-shaped IDs without changing files', async () => {
  const kept = output('origin.txt');
  assert.equal((await discard([kept.id], { origin: 'https://attacker.example' })).status, 403);
  assert.equal((await discard([kept.file])).status, 400);
  assert.equal((await discard([])).status, 400);
  assert.ok(fs.existsSync(kept.file));
});
test('shared output and assets survive until the final visible owner is discarded', async () => {
  const assets = path.join(OUTPUT_DIR, 'shared-assets');
  fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets, 'one.png'), 'asset');
  const first = output('shared.md', 'markdown', { assetsDir: assets });
  const second = registerDownload(first.file, 'shared.md', 'text/markdown', { assetsDir: assets });
  const secondId = second.downloadUrl.split('/').pop();
  assert.equal((await discard([first.id])).status, 200);
  assert.ok(fs.existsSync(first.file));
  assert.equal((await sessionFetch(`${origin}${second.downloadUrl}/asset/one.png`)).status, 200);
  assert.equal((await discard([secondId])).status, 200);
  await waitUntil(() => !fs.existsSync(first.file) && !fs.existsSync(assets));
});
test('active HTTP download keeps bytes until the response completes', async () => {
  const item = output('large.bin', Buffer.alloc(16 * 1024 * 1024, 93));
  const response = await new Promise((resolve, reject) => {
    http.get(origin + item.downloadUrl, res => { res.pause(); resolve(res); }).on('error', reject);
  });
  assert.equal((await discard([item.id])).status, 200);
  assert.ok(fs.existsSync(item.file), 'in-flight download must retain its source');
  let bytes = 0;
  await new Promise((resolve, reject) => {
    response.on('data', chunk => { bytes += chunk.length; });
    response.on('end', resolve); response.on('error', reject); response.resume();
  });
  assert.equal(bytes, 16 * 1024 * 1024);
  await waitUntil(() => !fs.existsSync(item.file));
});
test('release does not delete files outside output root, replaced identities or new asset files', async () => {
  const outside = path.join(runtime, 'user.txt');
  fs.writeFileSync(outside, 'user');
  const external = registerDownload(outside, 'user.txt', 'text/plain');
  const replaced = output('replaced.txt');
  fs.renameSync(replaced.file, replaced.file + '.original');
  fs.writeFileSync(replaced.file, 'replacement');
  const assets = path.join(OUTPUT_DIR, 'changed-assets'); fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets, 'original.png'), 'generated');
  const owned = output('with-assets.md', 'md', { assetsDir: assets });
  fs.writeFileSync(path.join(assets, 'user-added.txt'), 'user');
  assert.equal((await discard([external.downloadUrl.split('/').pop(), replaced.id, owned.id])).status, 200);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'user');
  assert.equal(fs.readFileSync(replaced.file, 'utf8'), 'replacement');
  assert.equal(fs.readFileSync(path.join(assets, 'user-added.txt'), 'utf8'), 'user');
  assert.equal(fs.existsSync(path.join(assets, 'original.png')), false);
});
test('release refuses linked roots and linked or hardlinked registered files', async () => {
  const original = output('link-source.txt', 'protected');
  const hard = path.join(OUTPUT_DIR, 'hard.txt'); fs.linkSync(original.file, hard);
  const item = registerDownload(hard, 'hard.txt', 'text/plain');
  assert.equal((await discard([item.downloadUrl.split('/').pop()])).status, 200);
  assert.ok(fs.existsSync(hard));
  const outside = path.join(runtime, 'outside-assets'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'protected');
  const linked = path.join(OUTPUT_DIR, 'linked-assets'); fs.symlinkSync(outside, linked, 'junction');
  const linkedItem = output('linked.md', 'md', { assetsDir: linked });
  await discard([linkedItem.id]);
  assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'protected');
});

test('aborted download releases its discarded output without waiting for a full body', async () => {
  const item = output('aborted.bin', Buffer.alloc(16 * 1024 * 1024, 42));
  const response = await new Promise((resolve, reject) => {
    http.get(origin + item.downloadUrl, res => { res.pause(); resolve(res); }).on('error', reject);
  });
  await discard([item.id]);
  assert.ok(fs.existsSync(item.file));
  response.destroy();
  await waitUntil(() => !fs.existsSync(item.file));
});

test('replacing the output root cannot make discard delete a new same-name file', async () => {
  const item = output('root-replacement.txt', 'old');
  const moved = OUTPUT_DIR + '-original';
  fs.renameSync(OUTPUT_DIR, moved);
  try {
    fs.mkdirSync(OUTPUT_DIR);
    fs.writeFileSync(item.file, 'new root content');
    assert.equal((await discard([item.id])).status, 200);
    assert.equal(fs.readFileSync(item.file, 'utf8'), 'new root content');
    assert.ok(downloads.has(item.id), 'keep replaced ownership protected from age cleanup');
  } finally {
    fs.unlinkSync(item.file); fs.rmdirSync(OUTPUT_DIR); fs.renameSync(moved, OUTPUT_DIR);
  }
});
