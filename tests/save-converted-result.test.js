const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { saveConvertedResult, rewriteAssetReferences } = require("../src/save-converted-result");

async function fixture(t, markdown = "![figure](原报告.assets/image-1.png)\n", missing = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fm-save-result-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const server = http.createServer((req, res) => {
    if (req.url === "/main") res.end(markdown);
    else if (req.url === "/asset" && !missing) res.end("PNG IMAGE");
    else { res.statusCode = 404; res.end("missing"); }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const result = { fileName: "原报告.md", downloadUrl: `${base}/main`, assets: [{ name: "image-1.png", url: `${base}/asset` }] };
  return { root, result };
}

test("renaming Markdown saves every resource and rewrites references to its owned directory", async (t) => {
  const { root, result } = await fixture(t);
  const target = path.join(root, "另存名.md");
  const saved = await saveConvertedResult(result, target);
  const markdown = await fs.readFile(target, "utf8");
  const reference = markdown.match(/\]\(([^)]+)\)/)[1];
  assert.equal(await fs.readFile(path.join(root, reference), "utf8"), "PNG IMAGE");
  assert.equal(path.dirname(path.join(root, reference)), saved.assetsDirectory);
  assert.doesNotMatch(markdown, /原报告.assets/);
});

test("failed asset download preserves old document and sidecar and rejects save", async (t) => {
  const { root, result } = await fixture(t, undefined, true);
  const target = path.join(root, "existing.md");
  await fs.mkdir(path.join(root, "existing.assets"));
  await fs.writeFile(path.join(root, "existing.assets", "old.png"), "old image");
  await fs.writeFile(target, "old document");
  await assert.rejects(saveConvertedResult(result, target), /保存失败/);
  assert.equal(await fs.readFile(target, "utf8"), "old document");
  assert.equal(await fs.readFile(path.join(root, "existing.assets", "old.png"), "utf8"), "old image");
  assert.deepEqual((await fs.readdir(root)).sort(), ["existing.assets", "existing.md"]);
});

test("unlisted resource reference rejects an incomplete result", async (t) => {
  const { root, result } = await fixture(t, "![figure](原报告.assets/missing.png)");
  await assert.rejects(saveConvertedResult(result, path.join(root, "saved.md")), /附件不完整/);
  assert.deepEqual(await fs.readdir(root), []);
});

test("an asset filename prefix cannot satisfy a different missing asset", async (t) => {
  const { root, result } = await fixture(t, "![figure](原报告.assets/image-1.png.other)");
  await assert.rejects(saveConvertedResult(result, path.join(root, "saved.md")), /附件不完整/);
  assert.deepEqual(await fs.readdir(root), []);
});

test("asset URLs are validated before downloading and path traversal is rejected", async (t) => {
  const { root, result } = await fixture(t);
  const destination = path.join(root, "saved.md");
  await assert.rejects(saveConvertedResult(result, destination, { resolveUrl: (url) => {
    if (url.endsWith("/asset")) throw new Error("untrusted");
    return url;
  } }), /untrusted/);
  result.assets[0].name = "../outside.png";
  await assert.rejects(saveConvertedResult(result, destination), /附件名称无效/);
  assert.deepEqual(await fs.readdir(root), []);
});

test("empty asset manifest cannot silently publish Markdown with missing generated resources", async (t) => {
  const { root, result } = await fixture(t);
  result.assets = [];
  await assert.rejects(saveConvertedResult(result, path.join(root, "saved.md")), /附件不完整/);
  assert.deepEqual(await fs.readdir(root), []);
});

test("overwrite false preserves existing Markdown and cleans only newly created assets", async (t) => {
  const { root, result } = await fixture(t);
  const target = path.join(root, "saved.md");
  await fs.writeFile(target, "original document");
  await assert.rejects(saveConvertedResult(result, target, { overwrite: false }), /EEXIST/);
  assert.equal(await fs.readFile(target, "utf8"), "original document");
  assert.deepEqual(await fs.readdir(root), ["saved.md"]);
});

test("batch Markdown save retains its resources on filesystems without hard links", async (t) => {
  const { root, result } = await fixture(t);
  t.mock.method(fs, "link", async () => {
    throw Object.assign(new Error("hard links unsupported"), { code: "ENOTSUP" });
  });
  const target = path.join(root, "saved.md");
  const saved = await saveConvertedResult(result, target, { overwrite: false });
  const markdown = await fs.readFile(target, "utf8");
  const reference = markdown.match(/\]\(([^)]+)\)/)[1];
  assert.equal(path.dirname(path.join(root, reference)), saved.assetsDirectory);
  assert.equal(await fs.readFile(path.join(root, reference), "utf8"), "PNG IMAGE");
  assert.ok(!(await fs.readdir(root)).some((name) => name.endsWith(".partial")));
});

test("saving literal attachment examples preserves their complete UTF-8 bytes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fm-save-code-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, "saved.md");
  const original = Buffer.from("\ufeff# 路径示例\r\n普通文字 example.assets/missing.png\r\n\r\n```text\r\n![not an image](example.assets/missing.png)\r\n```\r\n\r\n`example.assets/missing.png`\r\n\r\n    ![indented](example.assets/missing.png)\r\n");
  const saved = await saveConvertedResult({ fileName: "example.md", downloadUrl: "memory:main", assets: [] }, target,
    { download: (_url, destination) => fs.writeFile(destination, original) });
  assert.deepEqual(await fs.readFile(target), original);
  assert.equal(saved.assetsDirectory, null);
  assert.deepEqual(await fs.readdir(root), ["saved.md"]);
});

test("rewriting a real image changes its destination only, including repeated code examples", () => {
  const preserved = "literal example.assets/image.png\r\n\r\n```md\r\n![actual](example.assets/image.png)\r\n```\r\n\r\n~~~html\r\n<img src='example.assets/image.png'>\r\n~~~\r\n\r\n`![actual](example.assets/image.png)`\r\n\r\n    ![actual](example.assets/image.png)\r\n";
  const actual = '![example.assets/image.png](example.assets/image.png "example.assets/image.png")\r\n';
  assert.equal(rewriteAssetReferences(preserved + actual, "example.md", [{ name: "image.png" }], "fm-assets-owned"),
    preserved + '![example.assets/image.png](fm-assets-owned/image.png "example.assets/image.png")\r\n');
});

test("nested containers retain indentation, escapes, code and original line endings", () => {
  const markdown = '> - `![code](example.assets/image.png)`\r\n>\r\n>   ```md\r\n>   ![code](example.assets/image.png)\r\n>   ```\r\n>\r\n> - [real](example.assets/image.png)\r\n\r\n\\[escaped\\](example.assets/image.png)\r\n';
  const expected = markdown.replace('[real](example.assets/image.png)', '[real](fm-assets-owned/image.png)');
  assert.equal(rewriteAssetReferences(markdown, "example.md", [{ name: "image.png" }], "fm-assets-owned"), expected);
});

test("reference definitions rewrite the destination and preserve title and code", () => {
  const markdown = '![figure][photo]\n\n[photo]: <example.assets/a b(1).png> "example.assets/literal.png"\n\n```md\n[photo]: <example.assets/missing.png>\n```\n';
  assert.equal(rewriteAssetReferences(markdown, "example.md", [{ name: "a b(1).png" }], "fm-assets-owned"),
    markdown.replace('<example.assets/a b(1).png>', '<fm-assets-owned/a%20b%281%29.png>'));
});

test("destinations support escaped parentheses, URI encoding, query and fragment without prefix matches", () => {
  const markdown = '[one](example.assets/a\\(b\\).png?download=1#part) ![two](%E5%8E%9F%E6%8A%A5%E5%91%8A.assets/a%28b%29.png)';
  assert.equal(rewriteAssetReferences(markdown, "example.md", [{ name: "a(b).png" }], "fm-assets-owned"),
    '[one](fm-assets-owned/a%28b%29.png?download=1#part) ![two](%E5%8E%9F%E6%8A%A5%E5%91%8A.assets/a%28b%29.png)');
  assert.throws(() => rewriteAssetReferences('![bad](example.assets/a\\(b\\).png.other)', "example.md", [{ name: "a(b).png" }], "fm-assets-owned"), /附件不完整/);
});

test("HTML actual src and href attributes rewrite without changing other attributes or raw script text", () => {
  const markdown = '<div>\n<img alt="example.assets/missing.png > example" src="example.assets/image.png" title="example.assets/literal.png">\n<a href=example.assets/image.png>example.assets/image.png</a>\n</div>\n\n<script>const example = \'<img src="example.assets/missing.png">\';</script>\n\n<!-- <img src="example.assets/missing.png"> -->\n';
  assert.equal(rewriteAssetReferences(markdown, "example.md", [{ name: "image.png" }], "fm-assets-owned"),
    markdown.replace('src="example.assets/image.png"', 'src="fm-assets-owned/image.png"').replace('href=example.assets/image.png', 'href=fm-assets-owned/image.png'));
});

test("actual missing references remain rejected in links, definitions, HTML and encoded paths", () => {
  for (const markdown of ['[missing](example.assets/missing.png)', '![x][missing]\n\n[missing]: example.assets/missing.png', '<img src="example.assets/missing.png">', '![x](example.assets/%6dissing.png)', '![x](example.assets/../outside.png)']) {
    assert.throws(() => rewriteAssetReferences(markdown, "example.md", [{ name: "image.png" }], "fm-assets-owned"), /附件不完整/, markdown);
  }
});

test("HTML entities, quote-safe filenames and encoded Chinese paths remain resolvable", () => {
  const markdown = '<img src="example&#46assets/a&amp;b.png?x=1&amp;y=2">\n\n<img src=\'example.assets/it&apos;s.png\'>\n';
  assert.equal(rewriteAssetReferences(markdown, "example.md", [{ name: "a&b.png" }, { name: "it's.png" }], "fm-assets-owned"),
    '<img src="fm-assets-owned/a%26b.png?x=1&amp;y=2">\n\n<img src=\'fm-assets-owned/it%27s.png\'>\n');
  assert.equal(rewriteAssetReferences('![中文](%E5%8E%9F%E6%8A%A5%E5%91%8A.assets/%E5%9B%BE%E7%89%87.png)', "原报告.md", [{ name: "图片.png" }], "fm-assets-owned"),
    '![中文](fm-assets-owned/%E5%9B%BE%E7%89%87.png)');
  assert.throws(() => rewriteAssetReferences('<img src="example&#46assets/missing.png">', "example.md", [], ""), /附件不完整/);
});

test("raw HTML examples and remote URLs are not mistaken for generated local attachments", () => {
  const markdown = 'inline <code>[sample](example.assets/missing.png)</code> and <script>const x="[link](example.assets/missing.png)";</script>\n\n<pre>![x](example.assets/missing.png)</pre>\n\n[remote](https://example.test/example.assets/image.png)\n[relative](other/example.assets/image.png)\n';
  assert.equal(rewriteAssetReferences(markdown, "example.md", [], ""), markdown);
});

test("HTML multiline container attributes preserve quote markers and other exact source bytes", () => {
  const markdown = '> <img\r\n> alt="example.assets/missing.png"\r\n> src="example.assets/image.png">\r\n';
  assert.equal(rewriteAssetReferences(markdown, "example.md", [{ name: "image.png" }], "fm-assets-owned"),
    markdown.replace('src="example.assets/image.png"', 'src="fm-assets-owned/image.png"'));
});

test("only the winning duplicate HTML attribute and reference definition are rewritten", () => {
  const markdown = '<img src="example.assets/image.png" src="example.assets/unused.png">\n\n![x][photo]\n\n[photo]: example.assets/image.png\n[ PHOTO ]: example.assets/unused.png\n';
  assert.equal(rewriteAssetReferences(markdown, "example.md", [{ name: "image.png" }], "fm-assets-owned"),
    markdown.replaceAll('example.assets/image.png', 'fm-assets-owned/image.png'));
});

test("rewriting preserves escaped entities and URL suffix spelling", () => {
  const markdown = String.raw`[one](example.assets/a\&amp;b.png?x=1&amp;y=2#part) [two](example.assets/a&amp;b.png)`;
  assert.equal(rewriteAssetReferences(markdown, "example.md", [{ name: "a&amp;b.png" }, { name: "a&b.png" }], "fm-assets-owned"),
    '[one](fm-assets-owned/a%26amp%3Bb.png?x=1&amp;y=2#part) [two](fm-assets-owned/a%26b.png)');
});

test("nested inline HTML code remains literal while a following real image is saved", () => {
  const markdown = 'before <code><code>[x](example.assets/missing.png)</code> [y](example.assets/missing.png)</code> after ![real](example.assets/image.png)\n';
  assert.equal(rewriteAssetReferences(markdown, "example.md", [{ name: "image.png" }], "fm-assets-owned"),
    markdown.replace('![real](example.assets/image.png)', '![real](fm-assets-owned/image.png)'));
});
