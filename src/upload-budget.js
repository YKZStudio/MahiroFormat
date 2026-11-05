"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { Transform, pipeline } = require("node:stream");
const multer = require("multer");
const { LIMITS, ResourceLimitError } = require("./resource-policy");
const RESERVE_BYTES = 1024 ** 3;
const DISK_CHECK_INTERVAL = 16 * 1024 ** 2;

function availableDiskBytes(directory, { statfs = fs.statfsSync } = {}) {
  if (typeof statfs === "function") {
    const stat = statfs(directory);
    return stat.bavail * stat.bsize;
  }
  // Electron 22 / Win7 uses Node 16, which predates fs.statfsSync. Keep the
  // legacy runtime usable without allowing an unbounded fallback upload.
  const drive = path.parse(path.resolve(directory)).root;
  if (process.platform !== "win32" || !/^[A-Za-z]:[\\/]$/.test(drive)) {
    throw new ResourceLimitError("UPLOAD_DISK_BUDGET_EXCEEDED");
  }
  const value = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `(New-Object System.IO.DriveInfo '${drive}').AvailableFreeSpace`],
  { encoding:"utf8", windowsHide:true, timeout:10000 });
  const bytes = Number(value.trim());
  if (!Number.isFinite(bytes) || bytes < 0) throw new ResourceLimitError("UPLOAD_DISK_BUDGET_EXCEEDED");
  return bytes;
}

function createBudgetedUpload({ directory, maxFileBytes = LIMITS.maxUploadBytes,
  maxBatchBytes = LIMITS.maxBatchBytes, reserveBytes = RESERVE_BYTES,
  readFreeBytes = availableDiskBytes } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const root = path.resolve(directory);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Upload root must be a regular directory");
  const requests = new WeakMap();
  const storage = {
    _handleFile(req, file, callback) {
      let budget;
      try {
        budget = requests.get(req);
        if (!budget) {
          const free = readFreeBytes(root);
          if (!Number.isFinite(free) || free <= reserveBytes) throw new ResourceLimitError("UPLOAD_DISK_BUDGET_EXCEEDED");
          // Leave room for native work files and outputs, not just the upload.
          budget = { bytes: 0, nextCheck: 0, maxBytes: Math.min(maxBatchBytes, Math.floor((free - reserveBytes) / 3)), files: new Map() };
          requests.set(req, budget);
        }
      } catch (error) { callback(error); return; }
      const filename = crypto.randomBytes(16).toString("hex");
      const target = path.join(root, filename);
      const guard = new Transform({ transform(chunk, _encoding, done) {
        try {
          budget.bytes += chunk.length;
          if (budget.bytes > budget.maxBytes) throw new ResourceLimitError("UPLOAD_DISK_BUDGET_EXCEEDED");
          if (budget.bytes >= budget.nextCheck) {
            const free = readFreeBytes(root);
            if (!Number.isFinite(free) || free - chunk.length <= reserveBytes) throw new ResourceLimitError("UPLOAD_DISK_BUDGET_EXCEEDED");
            budget.nextCheck = budget.bytes + DISK_CHECK_INTERVAL;
          }
          done(null, chunk);
        } catch (error) { done(error); }
      }});
      const output = fs.createWriteStream(target, { flags: "wx", mode: 0o600 });
      file.path = target;
      // Multer can copy its file object. Receipts belong to this request and
      // canonical target, not to the identity of that metadata object.
      const receipt = { output, identity: null };
      budget.files.set(target, receipt);
      output.once("open", fd => {
        try {
          const stat = fs.fstatSync(fd);
          receipt.identity = { dev:stat.dev, ino:stat.ino };
        } catch (error) { output.destroy(error); }
      });
      pipeline(file.stream, guard, output, error => {
        if (error) {
          // Multer does not uniformly register a failed _handleFile result for
          // cleanup across supported versions. Always retire our own partial.
          storage._removeFile(req, file, cleanupError => {
            if (cleanupError) error.uploadCleanupError = cleanupError.code || cleanupError.message;
            callback(error);
          });
          return;
        }
        callback(null, { destination:root, filename, path:target, size:output.bytesWritten });
      });
    },
    _removeFile(_req, file, callback) {
      const target = file.path;
      if (!target || path.dirname(path.resolve(target)) !== root || !/^[a-f0-9]{32}$/.test(path.basename(target))) {
        callback(new Error("Upload cleanup target is outside its owned directory")); return;
      }
      const receipt = requests.get(_req)?.files.get(target);
      const remove = () => {
        // An EEXIST/open failure never authorizes deletion of that path.
        if (!receipt?.identity) { callback(null); return; }
        try {
          const parent = fs.lstatSync(root);
          const stat = fs.lstatSync(target);
          if (!parent.isDirectory() || parent.isSymbolicLink() || parent.dev !== rootStat.dev || parent.ino !== rootStat.ino
            || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
            || stat.dev !== receipt.identity.dev || stat.ino !== receipt.identity.ino) {
            callback(null); return;
          }
          fs.unlinkSync(target);
          callback(null);
        } catch (error) { callback(error.code === "ENOENT" ? null : error); }
      };
      const output = receipt?.output;
      if (output && !output.closed) { output.once("close", remove); output.destroy(); }
      else remove();
    }
  };
  return multer({ storage, limits: { fileSize:maxFileBytes, files:LIMITS.maxUploadFiles } });
}

module.exports = { createBudgetedUpload, availableDiskBytes };
