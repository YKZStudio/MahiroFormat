"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { verifyPublicPackage } = require("../scripts/check-public-package");

const version = "0.7.4";
const publicManifest = { name: "mahiro-format", version, main: "src/electron-main.js",
  productName: "Mahiro Format" };

async function fixture(t, { manifest = publicManifest, files = {}, loose = {}, unpack } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fm-public-package-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const unpacked = path.join(root, "win-unpacked");
  await fs.mkdir(path.join(unpacked, "resources"), { recursive: true });
  for (const [name, contents] of Object.entries({ "package.json": JSON.stringify(manifest),
    "src/electron-main.js": "// test fixture", ...files })) {
    const destination = path.join(source, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, contents);
  }
  const imported = await import("@electron/asar");
  const asar = imported.default || imported;
  const archive = path.join(unpacked, "resources", "app.asar");
  await asar.createPackageWithOptions(source, archive, unpack ? { unpack } : {});
  for (const [name, contents] of Object.entries(loose)) {
    const destination = path.join(unpacked, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, contents);
  }
  return { unpacked, verify: () => verifyPublicPackage(unpacked, { expectedVersion: version }) };
}

test("public package accepts an actual ASAR and ordinary audio dependencies/resources", async t => {
  const f = await fixture(t, {
    files: { "node_modules/ordinary-audio/docs/local-music.js": "ordinary dependency documentation",
      "node_modules/ordinary-audio/README.md": "QQ music mention is not a decoder",
      "public/help.txt": "Special encrypted music is unsupported." },
    loose: { "resources/ffmpeg/ffmpeg.exe": "ordinary audio engine", "resources/avs3/decoder.exe": "legacy video engine" }
  });
  const result = await f.verify();
  assert.equal(result.ok, true);
  assert.equal(result.localMusicEnabled, false);
  assert.equal(result.version, version);
});

test("local music feature flags and product channels are rejected without local filenames", async t => {
  for (const patch of [
    { flyingMouseLocalAudio: true }, { flyingMouseLocalAudio: "true" },
    { flyingMouseBuildChannel: "LocalMusic" }, { flyingMouseBuildChannel: "local-music-startupfix-20260916" },
    { productName: "Mahiro Format Local Music" },
    { build: { extraMetadata: { flyingMouseLocalAudio: true } } }
  ]) {
    const f = await fixture(t, { manifest: { ...publicManifest, ...patch } });
    await assert.rejects(f.verify(), /local music|flyingMouseLocalAudio/i);
  }
  const f = await fixture(t, { manifest: { ...publicManifest, flyingMouseLocalAudio: false } });
  assert.equal((await f.verify()).ok, true);
});

test("root and nested application modules cannot bypass the gate with case or separators", async t => {
  for (const name of ["qq-music-format.js", "LocalMusic/index.cjs", "lib/QQ_Music/session.js",
    "src/ncm-format.js", "old/mflac-format.js", "KGG-FORMAT.JS", "src/kgma-format.js", "src/kwm-format.js",
    "src/ncm-metadata.js", "src/av3a-format.js", "vpr-format.js", "vendor/unlock-music/index.js"]) {
    const f = await fixture(t, { files: { [name]: "// prohibited fixture; no decoder implementation" } });
    await assert.rejects(f.verify(), /Local music ASAR entry is prohibited/);
  }
});

test("unpacked modules and independent engine resources are rejected", async t => {
  const unpackedModule = await fixture(t, { files: { "local-music-formats.js": "// local fixture" }, unpack: "*.js" });
  await assert.rejects(unpackedModule.verify(), /Local music resource is prohibited/);
  for (const name of ["resources/LocalMusic/engine.exe", "resources/music-unlock/engine.exe",
    "resources/ncmdump/ncmdump.exe", "resources/engines/QMC-Decoder.exe",
    "resources/app.asar.unpacked/lib/qq-music-validation.js"]) {
    const f = await fixture(t, { loose: { [name]: "prohibited fixture" } });
    await assert.rejects(f.verify(), /Local music resource is prohibited/);
  }
});

test("named unlock dependencies are rejected while ordinary dependency interiors remain allowed", async t => {
  for (const name of ["node_modules/unlock-music/index.js", "node_modules/@flyingmouse/local-music/index.js",
    "node_modules/ordinary/node_modules/qq-music/index.js"]) {
    const f = await fixture(t, { files: { [name]: "// prohibited package fixture" } });
    await assert.rejects(f.verify(), /Local music ASAR entry is prohibited/);
  }
  const f = await fixture(t, { manifest: { ...publicManifest, dependencies: { "unlock-music": "1.0.0" } } });
  await assert.rejects(f.verify(), /Local music dependency is prohibited/);
});

test("missing, invalid and stale packaged manifests fail closed", async t => {
  for (const manifest of [{ ...publicManifest, version: "0.7.3" }, { ...publicManifest, main: "local.js" }]) {
    const f = await fixture(t, { manifest });
    await assert.rejects(f.verify(), /version|entry point/);
  }
  const corrupt = await fixture(t, { files: { "package.json": "{invalid" } });
  await assert.rejects(corrupt.verify(), SyntaxError);
  const missing = await fixture(t);
  await fs.unlink(path.join(missing.unpacked, "resources", "app.asar"));
  await assert.rejects(missing.verify(), /ENOENT/);
});

test("command line gate exits nonzero for a real local ASAR", async t => {
  const f = await fixture(t, { manifest: { ...publicManifest, flyingMouseLocalAudio: true } });
  const result = spawnSync(process.execPath, [path.join(__dirname, "../scripts/check-public-package.js"),
    f.unpacked, version], { encoding: "utf8", windowsHide: true });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).ok, false);
  assert.match(result.stderr, /flyingMouseLocalAudio/);
});
