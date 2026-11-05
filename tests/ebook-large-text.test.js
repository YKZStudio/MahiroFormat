const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const yauzl = require('yauzl');
const { convertTextToEpub, splitChapters } = require('../src/ebook');
const { withConversionProgress } = require('../src/conversion-progress');

async function entries(file) {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error);
    const result = [];
    zip.on('error', reject);
    zip.on('end', () => resolve(result));
    zip.on('entry', entry => zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error);
      const chunks = [];
      stream.on('error', reject);
      stream.on('data', data => chunks.push(data));
      stream.on('end', () => { result.push({ name: entry.fileName, method: entry.compressionMethod, bytes: Buffer.concat(chunks) }); zip.readEntry(); });
    }));
    zip.readEntry();
  }));
}
function textBody(doc) {
  return /<p>([\s\S]*)<\/p>/.exec(doc)[1].replace(/<br \/>/g, '\n')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
async function directory(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fmf-epub-large-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('large short-paragraph TXT has bounded chapters and preserves every character and blank line', () => {
  const text = ('  第十三章\n小林收好账本1186元。\n\n\n').repeat(50000) + '尾部核验';
  const parts = splitChapters(text, 'txt');
  assert.ok(parts.length < 200, `unexpected chapter expansion: ${parts.length}`);
  assert.equal(parts.map(part => part.body).join(''), text);
  assert.ok(parts.every(part => part.body.length <= 32768));
});

test('a giant paragraph splits without broken surrogate pairs or added separators', () => {
  const text = ('中文😀𠮷尾').repeat(12000);
  const parts = splitChapters(text, 'txt');
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => part.body.length <= 32768));
  assert.ok(parts.every(part => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(part.body)));
  assert.equal(parts.map(part => part.body).join(''), text);
});

test('EPUB compression is sequential, complete and reports only actually completed chapters', async t => {
  const dir = await directory(t), output = path.join(dir, 'book.epub');
  const text = Array.from({ length: 40 }, (_, i) => `# 第${i + 1}章\n\n内容${i}😀`).join('\n');
  let active = 0, peak = 0;
  const originalRaw = zlib.deflateRaw, descriptor = Object.getOwnPropertyDescriptor(zlib, 'DeflateRaw');
  zlib.deflateRaw = function (...args) {
    active++; peak = Math.max(peak, active);
    const callback = args.pop();
    return originalRaw.call(this, ...args, (...values) => { active--; callback(...values); });
  };
  Object.defineProperty(zlib, 'DeflateRaw', { ...descriptor, value: function (...args) {
    const stream = new descriptor.value(...args); active++; peak = Math.max(peak, active);
    stream.once('end', () => active--); return stream;
  } });
  const events = [];
  try {
    await withConversionProgress({ report: event => { events.push(event); return true; } }, () => convertTextToEpub(text, 'md', 'book.md', output));
  } finally { zlib.deflateRaw = originalRaw; Object.defineProperty(zlib, 'DeflateRaw', descriptor); }
  assert.ok(peak <= 1, `peak simultaneous compressors: ${peak}`);
  const archive = await entries(output);
  assert.equal(archive[0].name, 'mimetype'); assert.equal(archive[0].method, 0);
  assert.equal(archive[0].bytes.toString(), 'application/epub+zip');
  const chapters = archive.filter(entry => /chapter-\d+\.xhtml$/.test(entry.name));
  assert.equal(chapters.length, 40);
  for (let i = 0; i < 40; i++) assert.match(chapters[i].bytes.toString(), new RegExp(`内容${i}😀`));
  assert.deepEqual(events.filter(event => event.unit === 'chapters').map(event => event.completed), Array.from({ length: 41 }, (_, i) => i));
  assert.equal(events.at(-1).stage, 'validating');
  assert.equal(active, 0);
});

test('plain EPUB archive retains blank lines and final text across chapter boundaries', async t => {
  const dir = await directory(t), output = path.join(dir, 'book.epub');
  const text = ('  空行&标点<原文>😀\n\n\n').repeat(12000) + '终章';
  await convertTextToEpub(text, 'txt', 'book.txt', output);
  const archive = await entries(output);
  assert.equal(archive.filter(entry => /chapter-\d+\.xhtml$/.test(entry.name)).map(entry => textBody(entry.bytes.toString())).join(''), text);
});

test('EPUB cancellation rejects and removes its own partial output', async t => {
  const dir = await directory(t), output = path.join(dir, 'book.epub');
  const controller = new AbortController();
  const events = [];
  const scope = { report(event) { events.push(event); if (event.unit === 'chapters' && event.completed === 1) controller.abort(); return true; } };
  await assert.rejects(withConversionProgress(scope, () => convertTextToEpub('内容😀\n\n'.repeat(100000), 'txt', 'book.txt', output, { signal: controller.signal })), { code: 'CONVERSION_CANCELED' });
  assert.equal(fs.existsSync(output), false);
  assert.ok(!events.some(event => event.completed > 1));
});

test('EPUB output failure rejects without deleting an existing destination', async t => {
  const dir = await directory(t), output = path.join(dir, 'book.epub');
  await fsp.writeFile(output, 'existing user bytes');
  await assert.rejects(convertTextToEpub('内容', 'txt', 'book.txt', output), { code: 'EEXIST' });
  assert.equal(await fsp.readFile(output, 'utf8'), 'existing user bytes');
});

test('plain chapter splitting normalizes CRLF only and preserves other whitespace', () => {
  const text = '  标题\r\n\r\n\r\n孤立\r回车\t尾部  \r\n';
  assert.equal(splitChapters(text, 'txt').map(part => part.body).join(''), text.replace(/\r\n/g, '\n'));
  const html = `<p title="${'长属性😀&amp;'.repeat(10000)}">原文</p>`;
  assert.equal(splitChapters(html, 'html')[0].body, html);
  const md = '# 单章\n\n```text\n' + 'fence 内容😀\n'.repeat(10000) + '```';
  assert.equal(splitChapters(md, 'md').length, 1);
  assert.equal(splitChapters(md, 'md')[0].body, md.slice('# 单章\n\n'.length));
});

for (const failure of ['cancel', 'write']) {
  test(`EPUB ${failure} during active compression drains it, stops following chapters and removes partial output`, { timeout: 5000 }, async t => {
    const dir = await directory(t), output = path.join(dir, 'book.epub');
    const controller = new AbortController();
    const descriptor = Object.getOwnPropertyDescriptor(zlib, 'DeflateRaw');
    const originalCreate = fs.createWriteStream;
    let target, injected = false, active = 0, created = 0, ended = 0;
    fs.createWriteStream = function (...args) { const stream = originalCreate.call(this, ...args); if (args[0] === output) target = stream; return stream; };
    Object.defineProperty(zlib, 'DeflateRaw', { ...descriptor, value: function (...args) {
      const stream = new descriptor.value(...args); active++; created++;
      stream.once('end', () => { active--; ended++; });
      const transform = stream._transform;
      stream._transform = function (...values) {
        if (!injected && created === 4) {
          injected = true;
          if (failure === 'cancel') controller.abort();
          else target.destroy(Object.assign(new Error('test disk full during chapter'), { code: 'ENOSPC' }));
        }
        return transform.apply(this, values);
      };
      return stream;
    } });
    const events = [];
    try {
      await assert.rejects(withConversionProgress({ report(event) { events.push(event); return true; } }, () => convertTextToEpub('正文原文😀\n\n'.repeat(30000), 'txt', 'book.txt', output, { signal: controller.signal })), { code: failure === 'cancel' ? 'CONVERSION_CANCELED' : 'ENOSPC' });
    } finally { fs.createWriteStream = originalCreate; Object.defineProperty(zlib, 'DeflateRaw', descriptor); }
    assert.ok(injected);
    assert.equal(active, 0); assert.equal(created, ended);
    assert.equal(created, 4, 'no compressor should start after the interrupted chapter');
    assert.equal(fs.existsSync(output), false);
    assert.ok(!events.some(event => event.completed > 1 || event.stage === 'validating'));
  });
}

test('EPUB final write error after the ZIP stream ends still rejects and cleans up', { timeout: 3000 }, async t => {
  const dir = await directory(t), output = path.join(dir, 'book.epub');
  const originalCreate = fs.createWriteStream;
  fs.createWriteStream = function (...args) {
    const stream = originalCreate.call(this, ...args);
    if (args[0] === output) stream._final = callback => callback(Object.assign(new Error('test late disk full'), { code: 'ENOSPC' }));
    return stream;
  };
  try { await assert.rejects(convertTextToEpub('原文', 'txt', 'book.txt', output), { code: 'ENOSPC' }); }
  finally { fs.createWriteStream = originalCreate; }
  assert.equal(fs.existsSync(output), false);
});

test('EPUB failed-output cleanup preserves a replacement file at the same path', async t => {
  const dir = await directory(t), output = path.join(dir, 'book.epub');
  const originalCreate = fs.createWriteStream;
  fs.createWriteStream = function (...args) {
    const stream = originalCreate.call(this, ...args);
    if (args[0] === output) {
      stream._final = callback => callback(Object.assign(new Error('test late write failure'), { code: 'ENOSPC' }));
      stream.prependOnceListener('close', () => {
        fs.renameSync(output, path.join(dir, 'owned-partial.epub'));
        fs.writeFileSync(output, 'replacement content must survive');
      });
    }
    return stream;
  };
  try { await assert.rejects(convertTextToEpub('原文', 'txt', 'book.txt', output), { code: 'ENOSPC' }); }
  finally { fs.createWriteStream = originalCreate; }
  assert.equal(await fsp.readFile(output, 'utf8'), 'replacement content must survive');
});

test('application shutdown cancels EPUB at its next chapter boundary in an isolated process', async t => {
  const dir = await directory(t), output = path.join(dir, 'book.epub');
  const program = `const assert=require('node:assert/strict');
    const {convertTextToEpub}=require(${JSON.stringify(require.resolve('../src/ebook'))});
    const {withConversionProgress}=require(${JSON.stringify(require.resolve('../src/conversion-progress'))});
    const {beginApplicationShutdown}=require(${JSON.stringify(require.resolve('../src/conversion-cancellation'))});
    withConversionProgress({report(event){if(event.completed===1)beginApplicationShutdown();return true;}},
      ()=>convertTextToEpub('正文'.repeat(100000),'txt','book.txt',${JSON.stringify(output)}))
      .then(()=>{throw Error('unexpected success');},error=>{assert.equal(error.code,'CONVERSION_CANCELED');assert.equal(require('fs').existsSync(${JSON.stringify(output)}),false);})
      .catch(error=>{console.error(error);process.exitCode=1;});`;
  const result = require('node:child_process').spawnSync(process.execPath, ['-e', program], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
});
