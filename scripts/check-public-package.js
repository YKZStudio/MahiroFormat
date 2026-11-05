"use strict";

// Inspect the built ASAR and loose resources, including -SkipBuild inputs.
// This gate contains only distribution policy names, never decoder code.
const fs = require("node:fs");
const path = require("node:path");

const LOCAL_MODULES = new Set([
  "ncmformat", "ncmmetadata", "av3aformat", "kggformat", "kggdbsearch",
  "mflacformat", "mggformat", "kgmaformat", "kwmformat", "vprformat",
  "qmcformat", "mmp4format"
]);
const LOCAL_ENGINES = new Set([
  "ncmdump", "qmcdecoder", "qmcdecode", "qmcdump", "qmcflac", "qmcogg",
  "kgmdecryptor", "kgmadecoder", "kggdecoder", "musicdecrypt", "musicdecryptor",
  "musicdecrypto", "musicdecoders"
]);

function compactName(value) {
  return String(value).toLowerCase().replace(/[\s._-]/g, "");
}

function localName(value) {
  // Extensions are irrelevant to the channel boundary: a renamed DLL/ASAR
  // directory must not make a known local module or engine distributable.
  const stem = String(value).replace(/^\.+/, "").split(".")[0];
  const compact = compactName(stem);
  return /^(?:localmusic|qqmusic|unlockmusic|musicunlock)/.test(compact)
    || LOCAL_MODULES.has(compact) || LOCAL_ENGINES.has(compact);
}

function pathParts(value) {
  const normalized = String(value).replace(/\\/g, "/").replace(/^\//, "");
  const parts = normalized.split("/");
  if (!normalized || parts.some(part => !part || part === "." || part === ".."
    || /[:\0]/.test(part) || part !== part.trimEnd().replace(/\.+$/, ""))) {
    throw new Error(`Unsafe packaged path: ${value}`);
  }
  return parts;
}

function forbiddenPath(value) {
  const parts = pathParts(value);
  const dependencyIndex = parts.findIndex(part => part.toLowerCase() === "node_modules");
  if (dependencyIndex < 0) return parts.some(localName);
  // Inspect application-owned prefixes and dependency package names, but do
  // not classify arbitrary files inside ordinary third-party dependencies.
  if (parts.slice(0, dependencyIndex).some(localName)) return true;
  for (let index = dependencyIndex; index < parts.length; index++) {
    if (parts[index].toLowerCase() !== "node_modules") continue;
    const first = parts[index + 1];
    if (!first) continue;
    const packageName = first.startsWith("@") ? parts[index + 2] : first;
    if (packageName && localName(packageName)) return true;
  }
  return false;
}

function assertManifest(manifest, expectedVersion) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Packaged package.json must be an object.");
  }
  if (manifest.name !== "mahiro-format" || manifest.main !== "src/electron-main.js") {
    throw new Error("Unexpected packaged application name or entry point.");
  }
  if (manifest.version !== expectedVersion) {
    throw new Error(`Packaged version ${manifest.version} differs from expected ${expectedVersion}.`);
  }
  const metadata = [manifest, manifest.build?.extraMetadata].filter(Boolean);
  for (const item of metadata) {
    if (Object.hasOwn(item, "flyingMouseLocalAudio") && item.flyingMouseLocalAudio !== false) {
      throw new Error("Public package must not enable flyingMouseLocalAudio.");
    }
  }
  const identityFields = [manifest.name, manifest.productName, manifest.flyingMouseBuildChannel,
    manifest.build?.appId, manifest.build?.productName, manifest.build?.nsis?.shortcutName,
    manifest.build?.extraMetadata?.flyingMouseBuildChannel];
  if (identityFields.some(value => value != null && /localmusic|qqmusic/.test(compactName(value)))) {
    throw new Error("Public package contains a local music product identity or build channel.");
  }
  for (const dependencies of [manifest.dependencies, manifest.optionalDependencies]) {
    for (const name of Object.keys(dependencies || {})) {
      if (localName(name.split("/").pop())) throw new Error(`Local music dependency is prohibited: ${name}`);
    }
  }
}

async function verifyPublicPackage(unpackedPath, { expectedVersion } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(expectedVersion || "")) {
    throw new Error("An expected x.y.z release version is required.");
  }
  const root = path.resolve(unpackedPath);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Expected a real unpacked application directory.");
  }
  let checkedDiskFiles = 0;
  function inspectDisk(directory, relative = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (forbiddenPath(name)) throw new Error(`Local music resource is prohibited: ${name}`);
      if (entry.isSymbolicLink()) throw new Error(`Package contains a link or junction: ${name}`);
      if (entry.isDirectory()) inspectDisk(path.join(directory, entry.name), name);
      else if (entry.isFile()) checkedDiskFiles++;
      else throw new Error(`Unexpected packaged filesystem entry: ${name}`);
    }
  }
  inspectDisk(root);
  const archive = path.join(root, "resources", "app.asar");
  const imported = await import("@electron/asar");
  const asar = imported.default || imported;
  // An earlier check in this process must not conceal a replaced build file.
  asar.uncache(archive);
  try {
    const entries = asar.listPackage(archive);
    for (const name of entries) {
      if (forbiddenPath(name)) throw new Error(`Local music ASAR entry is prohibited: ${name}`);
    }
    const info = asar.statFile(archive, "package.json", false);
    if (info.link || info.files || info.size > 1024 * 1024) {
      throw new Error("Packaged package.json must be a bounded regular file.");
    }
    const manifest = JSON.parse(asar.extractFile(archive, "package.json", false).toString("utf8"));
    assertManifest(manifest, expectedVersion);
    return { ok: true, publicOnly: true, version: manifest.version, localMusicEnabled: false,
      asar: archive, checkedArchiveEntries: entries.length, checkedDiskFiles };
  } finally {
    asar.uncache(archive);
  }
}

async function main(args) {
  if (args.length !== 2) throw new Error("Usage: node scripts/check-public-package.js <win-unpacked> <expected-version>");
  return verifyPublicPackage(args[0], { expectedVersion: args[1] });
}

if (require.main === module) {
  main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(JSON.stringify({ ok: false, errors: [error.message] }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { verifyPublicPackage };
