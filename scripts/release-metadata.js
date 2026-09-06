"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const version = read("package.json").version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Expected a stable semantic version");
for (const file of ["package-lock.json", "win7-package-lock.json"]) {
  const lock = read(file);
  if (lock.version !== version || lock.packages[""].version !== version) {
    throw new Error(`${file} version does not match package.json`);
  }
}
const expected = `v${version}`;
const tag = process.env.REQUESTED_TAG || (process.env.GITHUB_REF_TYPE === "tag"
  ? process.env.GITHUB_REF_NAME : read(".github/release-request.json").tag);
if (tag !== expected) throw new Error(`Release ${tag} does not match ${expected}`);
const notes = path.join(root, "docs", `release-notes-${version.replaceAll(".", "")}.md`);
if (!fs.existsSync(notes)) throw new Error("Version-specific release notes are required");
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\n`);
console.log(`Validated ${tag}; release target is the workflow's exact source commit.`);
