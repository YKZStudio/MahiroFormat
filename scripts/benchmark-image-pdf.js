"use strict";

// Example: node scripts/benchmark-image-pdf.js --baseline <commit> --samples 3
// Each measurement runs in a fresh process; fixtures and outputs are temporary.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");

async function worker([revision, inputPath, outputPath, pageCount]) {
  const filename = path.join(root, "image.js");
  const source = revision === "working-tree" ? fs.readFileSync(filename, "utf8")
    : execFileSync("git", ["show", `${revision}:image.js`], { cwd: root, encoding: "utf8" });
  const loaded = { exports: {} };
  vm.compileFunction(source, ["require", "module", "exports", "__filename", "__dirname"], { filename })(
    createRequire(filename), loaded, loaded.exports, filename, root);
  sharp.cache(false);
  let concatBytes = 0;
  const originalConcat = Buffer.concat;
  Buffer.concat = function (chunks, length) {
    concatBytes += length === undefined ? chunks.reduce((sum, chunk) => sum + chunk.length, 0) : length;
    return originalConcat(chunks, length);
  };
  const start = performance.now();
  try {
    await loaded.exports.convertImagesToPdf(Array.from({ length: Number(pageCount) }, () => ({ inputPath })), outputPath);
  } finally {
    Buffer.concat = originalConcat;
  }
  const elapsedMs = performance.now() - start;
  // Capture peak RSS before reading the output for equality verification.
  const peakRssMiB = process.resourceUsage().maxRSS / 1024;
  const bytes = await fsp.readFile(outputPath);
  return {
    revision, pages: Number(pageCount), elapsedMs: Math.round(elapsedMs),
    peakRssMiB: Math.round(peakRssMiB), concatMiB: Math.round(concatBytes / 1024 ** 2),
    outputBytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex")
  };
}

async function main(args) {
  if (args[0] === "--worker") return worker(args.slice(1));
  let baseline;
  let samples = 1;
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] === "--baseline" && args[index + 1]) {
      baseline = execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${args[index + 1]}^{commit}`],
        { cwd: root, encoding: "utf8" }).trim();
    } else if (args[index] === "--samples" && /^[1-9]$/.test(args[index + 1] || "")) {
      samples = Number(args[index + 1]);
    } else {
      throw new Error("Usage: node scripts/benchmark-image-pdf.js [--baseline <commit>] [--samples <1-9>]");
    }
  }
  const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "mahiro-pdf-benchmark-"));
  try {
    const inputPath = path.join(scratch, "noise.png");
    const pixels = Buffer.alloc(512 * 512 * 3);
    let seed = 0x12345678;
    for (let index = 0; index < pixels.length; index += 1) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      pixels[index] = seed & 0xff;
    }
    await sharp(pixels, { raw: { width: 512, height: 512, channels: 3 } }).png().toFile(inputPath);
    const measurements = [];
    for (const pages of [8, 24, 48]) {
      let expectedHash;
      for (let sample = 0; sample < samples; sample += 1) {
        const revisions = baseline ? [baseline, "working-tree"] : ["working-tree"];
        if (sample % 2) revisions.reverse();
        for (const revision of revisions) {
          const outputPath = path.join(scratch, `${pages}-${sample}-${revision}.pdf`);
          const measurement = JSON.parse(execFileSync(process.execPath,
            [__filename, "--worker", revision, inputPath, outputPath, String(pages)],
            { cwd: root, encoding: "utf8", timeout: 120_000 }));
          if (expectedHash) assert.equal(measurement.sha256, expectedHash, "PDF output must be byte-identical");
          expectedHash = measurement.sha256;
          measurements.push(measurement);
          await fsp.unlink(outputPath);
        }
      }
    }
    return { node: process.version, platform: process.platform, arch: process.arch, fixture: "512x512 deterministic RGB noise", measurements };
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
}

main(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
